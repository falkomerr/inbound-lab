import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { seal, unseal } from './core.js';

export const terminalStates = ['completed', 'failed', 'cancelled', 'interrupted'];
const decoded = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

export function readKey() {
  const key = Buffer.from(
    process.env.VPN_KEY ||
      readFileSync(process.env.VPN_KEY_FILE || '/run/secrets/vpn_key', 'utf8').trim(),
    'base64'
  );
  if (key.length !== 32) {
    throw Error('Нужен отдельный ключ шифрования длиной 32 байта');
  }
  return key;
}

export class VpnStore {
  constructor(pool = getPool(), key = readKey()) {
    this.pool = pool;
    this.key = key;
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS vpn_objects (
      id VARCHAR(36) PRIMARY KEY, kind VARCHAR(20) NOT NULL, group_id VARCHAR(36) NOT NULL,
      metadata JSON NOT NULL, payload MEDIUMTEXT NOT NULL, created BIGINT NOT NULL,
      INDEX kind_created(kind, created)
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS vpn_runs (
      id VARCHAR(36) PRIMARY KEY, request_key VARCHAR(100) NOT NULL UNIQUE,
      snapshot MEDIUMTEXT NOT NULL, metadata JSON NOT NULL, report JSON NOT NULL,
      state VARCHAR(20) NOT NULL, cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
      created BIGINT NOT NULL, updated BIGINT NOT NULL, INDEX state_created(state, created)
    )`);
  }

  async save(object) {
    const id = randomUUID(),
      created = Date.now();
    const metadata = { ...object.metadata, id, created, groupId: object.groupId || id };
    await this.pool.execute(
      'INSERT INTO vpn_objects(id, kind, group_id, metadata, payload, created) VALUES(?,?,?,?,?,?)',
      [
        id,
        object.kind,
        metadata.groupId,
        JSON.stringify(metadata),
        seal(object.payload, this.key),
        created,
      ]
    );
    return metadata;
  }

  async list(kind) {
    const [rows] = await this.pool.execute(
      'SELECT metadata FROM vpn_objects WHERE kind=? ORDER BY created DESC',
      [kind]
    );
    return rows.map((row) => decoded(row.metadata));
  }

  async get(id, kind) {
    const [rows] = await this.pool.execute('SELECT * FROM vpn_objects WHERE id=? AND kind=?', [
      id,
      kind,
    ]);
    if (!rows.length) {
      throw Error('notfound');
    }
    return {
      metadata: decoded(rows[0].metadata),
      payload: unseal(rows[0].payload, this.key),
      groupId: rows[0].group_id,
    };
  }

  async enqueue({ requestKey, profiles, scenario, load, metadata }) {
    const id = randomUUID(),
      now = Date.now();
    try {
      await this.pool.execute(
        'INSERT INTO vpn_runs(id,request_key,snapshot,metadata,report,state,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        [
          id,
          requestKey,
          seal({ profiles, scenario, load }, this.key),
          JSON.stringify(metadata),
          '{}',
          'queued',
          now,
          now,
        ]
      );
    } catch (error) {
      if (error.code !== 'ER_DUP_ENTRY') {
        throw error;
      }
    }
    const [rows] = await this.pool.execute('SELECT id FROM vpn_runs WHERE request_key=?', [
      requestKey,
    ]);
    return this.run(rows[0].id);
  }

  async runs() {
    const [rows] = await this.pool.query(
      'SELECT id,state,metadata,report,created,updated,cancel_requested FROM vpn_runs ORDER BY created DESC LIMIT 100'
    );
    return rows.map((r) => ({
      id: r.id,
      state: r.state,
      ...decoded(r.metadata),
      ...decoded(r.report),
      created: Number(r.created),
      updated: Number(r.updated),
      cancelRequested: Boolean(r.cancel_requested),
    }));
  }

  async run(id, secret = false) {
    const [rows] = await this.pool.execute('SELECT * FROM vpn_runs WHERE id=?', [id]);
    if (!rows.length) {
      throw Error('notfound');
    }
    const row = rows[0];
    return {
      id: row.id,
      state: row.state,
      ...decoded(row.metadata),
      ...decoded(row.report),
      created: Number(row.created),
      updated: Number(row.updated),
      ...(secret ? unseal(row.snapshot, this.key) : {}),
    };
  }

  async update(id, patch) {
    const { state, ...report } = patch;
    const [rows] = await this.pool.execute('SELECT report FROM vpn_runs WHERE id=?', [id]);
    if (!rows.length) {
      throw Error('notfound');
    }
    const merged = { ...decoded(rows[0].report), ...report };
    if (state) {
      await this.pool.execute('UPDATE vpn_runs SET state=?,report=?,updated=? WHERE id=?', [
        state,
        JSON.stringify(merged),
        Date.now(),
        id,
      ]);
    } else {
      await this.pool.execute('UPDATE vpn_runs SET report=?,updated=? WHERE id=?', [
        JSON.stringify(merged),
        Date.now(),
        id,
      ]);
    }
  }

  async cancel(id) {
    await this.pool.execute(
      "UPDATE vpn_runs SET cancel_requested=TRUE,state=IF(state='queued','cancelled','stopping'),updated=? WHERE id=? AND state NOT IN ('completed','failed','cancelled','interrupted')",
      [Date.now(), id]
    );
    return this.run(id);
  }

  async cancelled(id) {
    const [rows] = await this.pool.execute('SELECT cancel_requested FROM vpn_runs WHERE id=?', [
      id,
    ]);
    if (!rows.length) {
      throw Error('notfound');
    }
    return Boolean(rows[0].cancel_requested);
  }

  async claim(id) {
    const [result] = await this.pool.execute(
      "UPDATE vpn_runs SET state='preparing',updated=? WHERE id=? AND state='queued' AND cancel_requested=FALSE",
      [Date.now(), id]
    );
    return result.affectedRows === 1;
  }

  async pending() {
    const [rows] = await this.pool.query(
      "SELECT id FROM vpn_runs WHERE state='queued' ORDER BY created LIMIT 100"
    );
    return rows.map((r) => r.id);
  }

  async active() {
    const [rows] = await this.pool.query(
      "SELECT id FROM vpn_runs WHERE state IN ('preparing','running','stopping')"
    );
    return rows.map((r) => r.id);
  }

  async prune() {
    const cutoff = Date.now() - 30 * 86400 * 1000;
    await this.pool.execute(
      "DELETE FROM vpn_runs WHERE updated<? AND state IN ('completed','failed','cancelled','interrupted')",
      [cutoff]
    );
    await this.pool.execute(
      'DELETE FROM vpn_objects WHERE created<? AND id NOT IN (SELECT id FROM (SELECT o.id FROM vpn_objects o JOIN (SELECT group_id,MAX(created) AS latest FROM vpn_objects GROUP BY group_id) g ON o.group_id=g.group_id AND o.created=g.latest) kept)',
      [cutoff]
    );
  }
}
