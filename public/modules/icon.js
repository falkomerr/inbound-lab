/** @type {import("vue").Component} */
window.Icon = {
  name: 'Icon',
  props: {
    name: {
      type: String,
      required: true,
      validator: (value) => {
        const validIcons = [
          'chart',
          'clock',
          'trending-up',
          'play',
          'stop',
          'refresh',
          'requests',
          'lightning',
          'x-circle',
          'package',
          'users',
          'alert-triangle',
          'smoke',
          'load',
          'stress',
          'file',
          'trash',
          'document',
          'scroll',
          'search',
          'check-circle',
          'x',
          'info',
          'copy',
          'clipboard',
          'code',
          'download',
          'moon',
          'sun',
          'chevron-down',
          'chevron-up',
          'arrow-down',
          'arrow-up',
          'arrow-left',
          'plus',
        ];
        return validIcons.includes(value);
      },
    },
    size: {
      type: [String, Number],
      default: 24,
    },
    strokeWidth: {
      type: [String, Number],
      default: 2,
    },
    class: {
      type: String,
      default: '',
    },
  },
  computed: {
    iconSize() {
      return typeof this.size === 'number' ? this.size : parseInt(this.size, 10);
    },
    iconStrokeWidth() {
      return typeof this.strokeWidth === 'number' ? this.strokeWidth : parseFloat(this.strokeWidth);
    },
    iconName() {
      return this.name || 'info';
    },
  },
  render() {
    const iconPaths = {
      // Status & Navigation
      chart: [
        { tag: 'line', attrs: { x1: '18', y1: '20', x2: '18', y2: '10' } },
        { tag: 'line', attrs: { x1: '12', y1: '20', x2: '12', y2: '4' } },
        { tag: 'line', attrs: { x1: '6', y1: '20', x2: '6', y2: '14' } },
      ],
      clock: [
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
        { tag: 'polyline', attrs: { points: '12 6 12 12 16 14' } },
      ],
      'trending-up': [
        { tag: 'polyline', attrs: { points: '23 6 13.5 15.5 8.5 10.5 1 18' } },
        { tag: 'polyline', attrs: { points: '17 6 23 6 23 12' } },
      ],
      play: [{ tag: 'polygon', attrs: { points: '5 3 19 12 5 21 5 3' } }],
      stop: [{ tag: 'rect', attrs: { x: '6', y: '6', width: '12', height: '12' } }],
      refresh: [
        { tag: 'polyline', attrs: { points: '23 4 23 10 17 10' } },
        { tag: 'polyline', attrs: { points: '1 20 1 14 7 14' } },
        {
          tag: 'path',
          attrs: { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' },
        },
      ],
      // Metrics
      requests: [
        { tag: 'line', attrs: { x1: '18', y1: '20', x2: '18', y2: '10' } },
        { tag: 'line', attrs: { x1: '12', y1: '20', x2: '12', y2: '4' } },
        { tag: 'line', attrs: { x1: '6', y1: '20', x2: '6', y2: '14' } },
      ],
      lightning: [{ tag: 'polygon', attrs: { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' } }],
      'x-circle': [
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
        { tag: 'line', attrs: { x1: '15', y1: '9', x2: '9', y2: '15' } },
        { tag: 'line', attrs: { x1: '9', y1: '9', x2: '15', y2: '15' } },
      ],
      package: [
        { tag: 'line', attrs: { x1: '16.5', y1: '9.4', x2: '7.5', y2: '4.21' } },
        {
          tag: 'path',
          attrs: {
            d: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
          },
        },
        { tag: 'polyline', attrs: { points: '3.27 6.96 12 12.01 20.73 6.96' } },
        { tag: 'line', attrs: { x1: '12', y1: '22.08', x2: '12', y2: '12' } },
      ],
      users: [
        { tag: 'path', attrs: { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' } },
        { tag: 'circle', attrs: { cx: '9', cy: '7', r: '4' } },
        { tag: 'path', attrs: { d: 'M23 21v-2a4 4 0 0 0-3-3.87' } },
        { tag: 'path', attrs: { d: 'M16 3.13a4 4 0 0 1 0 7.75' } },
      ],
      'alert-triangle': [
        {
          tag: 'path',
          attrs: {
            d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
          },
        },
        { tag: 'line', attrs: { x1: '12', y1: '9', x2: '12', y2: '13' } },
        { tag: 'line', attrs: { x1: '12', y1: '17', x2: '12.01', y2: '17' } },
      ],
      // Presets
      smoke: [
        {
          tag: 'path',
          attrs: {
            d: 'M18 16.98h-5.99c-1.1 0-1.95.96-2.19 2.02-1.19-.88-2.11-2.07-2.62-3.37-.51-1.3-.51-2.7 0-4 .51-1.3 1.43-2.49 2.62-3.37.24 1.06 1.09 2.02 2.19 2.02h5.99c1.1 0 1.95-.96 2.19-2.02 1.19.88 2.11 2.07 2.62 3.37.51 1.3.51 2.7 0 4-.51 1.3-1.43 2.49-2.62 3.37-.24-1.06-1.09-2.02-2.19-2.02z',
          },
        },
        { tag: 'circle', attrs: { cx: '6', cy: '14', r: '2' } },
        { tag: 'circle', attrs: { cx: '18', cy: '6', r: '2' } },
      ],
      load: [{ tag: 'polygon', attrs: { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' } }],
      stress: [
        {
          tag: 'path',
          attrs: {
            d: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
          },
        },
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '3' } },
      ],
      // Actions
      file: [
        { tag: 'rect', attrs: { x: '4', y: '2', width: '16', height: '20', rx: '2', ry: '2' } },
        { tag: 'line', attrs: { x1: '8', y1: '9', x2: '16', y2: '9' } },
        { tag: 'line', attrs: { x1: '8', y1: '13', x2: '16', y2: '13' } },
        { tag: 'line', attrs: { x1: '8', y1: '17', x2: '16', y2: '17' } },
      ],
      trash: [
        { tag: 'path', attrs: { d: 'M3 6h18' } },
        { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
        { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
        { tag: 'line', attrs: { x1: '10', y1: '11', x2: '10', y2: '17' } },
        { tag: 'line', attrs: { x1: '14', y1: '11', x2: '14', y2: '17' } },
      ],
      document: [
        { tag: 'path', attrs: { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' } },
        { tag: 'polyline', attrs: { points: '14 2 14 8 20 8' } },
        { tag: 'line', attrs: { x1: '16', y1: '13', x2: '8', y2: '13' } },
        { tag: 'line', attrs: { x1: '16', y1: '17', x2: '8', y2: '17' } },
        { tag: 'polyline', attrs: { points: '10 9 9 9 8 9' } },
      ],
      scroll: [
        { tag: 'path', attrs: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } },
        { tag: 'polyline', attrs: { points: '7 10 12 15 17 10' } },
        { tag: 'line', attrs: { x1: '12', y1: '15', x2: '12', y2: '3' } },
      ],
      search: [
        { tag: 'circle', attrs: { cx: '11', cy: '11', r: '8' } },
        { tag: 'line', attrs: { x1: '21', y1: '21', x2: '16.65', y2: '16.65' } },
      ],
      // Status
      'check-circle': [
        { tag: 'path', attrs: { d: 'M22 11.08V12a10 10 0 1 1-5.93-9.14' } },
        { tag: 'polyline', attrs: { points: '22 4 12 14.01 9 11.01' } },
      ],
      x: [{ tag: 'line', attrs: { x1: '18', y1: '6', x2: '6', y2: '18' } }],
      info: [
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '10' } },
        { tag: 'line', attrs: { x1: '12', y1: '16', x2: '12', y2: '12' } },
        { tag: 'line', attrs: { x1: '12', y1: '8', x2: '12.01', y2: '8' } },
      ],
      // Copy/Clipboard icons
      copy: [
        { tag: 'rect', attrs: { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' } },
        { tag: 'path', attrs: { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' } },
      ],
      clipboard: [
        {
          tag: 'path',
          attrs: { d: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' },
        },
        { tag: 'rect', attrs: { x: '8', y: '2', width: '8', height: '4', rx: '1', ry: '1' } },
      ],
      // Export icons
      code: [
        { tag: 'polyline', attrs: { points: '16 18 22 12 16 6' } },
        { tag: 'polyline', attrs: { points: '8 6 2 12 8 18' } },
      ],
      download: [
        { tag: 'path', attrs: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' } },
        { tag: 'polyline', attrs: { points: '7 10 12 15 17 10' } },
        { tag: 'line', attrs: { x1: '12', y1: '15', x2: '12', y2: '3' } },
      ],
      // Dark mode icons
      moon: [{ tag: 'path', attrs: { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' } }],
      sun: [
        { tag: 'circle', attrs: { cx: '12', cy: '12', r: '5' } },
        { tag: 'line', attrs: { x1: '12', y1: '1', x2: '12', y2: '3' } },
        { tag: 'line', attrs: { x1: '12', y1: '21', x2: '12', y2: '23' } },
        { tag: 'line', attrs: { x1: '4.22', y1: '4.22', x2: '5.64', y2: '5.64' } },
        { tag: 'line', attrs: { x1: '18.36', y1: '18.36', x2: '19.78', y2: '19.78' } },
        { tag: 'line', attrs: { x1: '1', y1: '12', x2: '3', y2: '12' } },
        { tag: 'line', attrs: { x1: '21', y1: '12', x2: '23', y2: '12' } },
        { tag: 'line', attrs: { x1: '4.22', y1: '19.78', x2: '5.64', y2: '18.36' } },
        { tag: 'line', attrs: { x1: '18.36', y1: '5.64', x2: '19.78', y2: '4.22' } },
      ],
      // Auto-scroll icons
      'chevron-down': [{ tag: 'polyline', attrs: { points: '6 9 12 15 18 9' } }],
      'chevron-up': [{ tag: 'polyline', attrs: { points: '18 15 12 9 6 15' } }],
      'arrow-down': [
        { tag: 'line', attrs: { x1: '12', y1: '5', x2: '12', y2: '19' } },
        { tag: 'polyline', attrs: { points: '19 12 12 19 5 12' } },
      ],
      'arrow-up': [
        { tag: 'line', attrs: { x1: '12', y1: '19', x2: '12', y2: '5' } },
        { tag: 'polyline', attrs: { points: '5 12 12 5 19 12' } },
      ],
      'arrow-left': [
        { tag: 'line', attrs: { x1: '19', y1: '12', x2: '5', y2: '12' } },
        { tag: 'polyline', attrs: { points: '12 19 5 12 12 5' } },
      ],
      plus: [
        { tag: 'line', attrs: { x1: '12', y1: '5', x2: '12', y2: '19' } },
        { tag: 'line', attrs: { x1: '5', y1: '12', x2: '19', y2: '12' } },
      ],
    };

    const paths = iconPaths[this.iconName] || iconPaths.info;

    return Vue.h(
      'svg',
      {
        width: this.iconSize,
        height: this.iconSize,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': this.iconStrokeWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        class: this.class,
        'aria-hidden': 'true',
      },
      paths.map((path) => Vue.h(path.tag, { ...path.attrs }))
    );
  },
};
