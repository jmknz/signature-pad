/**
 * Reimplementation of Signature Pad v1.6.0-beta.6
 * https://github.com/szimek/signature_pad
 *
 * Copyright 2017 Szymon Nowak
 * Released under the MIT license
 *
 * The main idea and some parts of the code (e.g. drawing variable width Bézier curve) are taken from:
 * http://corner.squareup.com/2012/07/smoother-signatures.html
 *
 * Implementation of interpolation using cubic Bézier curves is taken from:
 * http://benknowscode.wordpress.com/2012/09/14/path-interpolation-using-cubic-bezier-and-control-point-estimation-in-javascript
 *
 * Algorithm for approximated length of a Bézier curve is taken from:
 * http://www.lemoda.net/maths/bezier-length/index.html
 *
 */

import Bezier from "./bezier.js";
import Point from "./point.js";

function t(func, wait, options = {}) {
  let context, args, result;
  let timeout = null;
  let previous = 0;

  const later = () => {
    previous = options.leading === false ? 0 : Date.now();
    timeout = null;
    result = func.apply(context, args);
    if (!timeout) context = args = null;
  };

  return function () {
    const now = Date.now();
    if (!previous && options.leading === false) previous = now;
    const remaining = wait - (now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };
}

export default class SignaturePad {
  constructor(
    canvas, {
      velocityFilterWeight = 0.7,
      minWidth = 0.5,
      maxWidth = 2.5,
      throttle = 0,
      penColor = 'black',
      backgroundColor = 'rgba(0, 0, 0, 0)',
      dotSize,
      onBegin,
      onEnd
    } = {
      velocityFilterWeight: 0.7,
      minWidth: 0.5,
      maxWidth: 2.5,
      throttle: 0,
      penColor: 'black',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      dotSize: 0,
      onBegin: undefined,
      onEnd: undefined,
    }
  ) {
    const self = this;

    this._canvas = canvas;
    this.velocityFilterWeight = velocityFilterWeight;
    this.minWidth = minWidth;
    this.maxWidth = maxWidth;
    this.throttle = throttle;

    if (this.throttle) {
      this._strokeMoveUpdate = t(this._strokeUpdate.bind(this), this.throttle);
    } else {
      this._strokeMoveUpdate = this._strokeUpdate.bind(this);
    }

    this.dotSize = dotSize || function () {
      return (this.minWidth + this.maxWidth) / 2;
    };

    this.penColor = penColor;
    this.backgroundColor = backgroundColor;
    this.onBegin = onBegin;
    this.onEnd = onEnd;

    this._ctx = canvas.getContext('2d');
    this.clear();

    this._handleMouseDown = (event) => {
      if (event.which === 1) {
        this._mouseButtonDown = true;
        this._strokeBegin(event);
      }
    };

    this._handleMouseMove = (event) => {
      if (this._mouseButtonDown) {
        this._strokeMoveUpdate(event, true);
      }
    };

    this._handleMouseUp = (event) => {
      if (event.which === 1 && this._mouseButtonDown) {
        this._mouseButtonDown = false;
        this._strokeEnd(event);
      }
    };

    this._handleTouchStart = (event) => {
      if (event.targetTouches.length === 1) {
        const touch = event.changedTouches[0];
        this._strokeBegin(touch);
      }
    };

    this._handleTouchMove = (event) => {
      // Prevent scrolling
      event.preventDefault();

      const touch = event.targetTouches[0];
      this._strokeMoveUpdate(touch, true);
    };

    this._handleTouchEnd = (event) => {
      const wasCanvasTouched = event.target === self._canvas;
      if (wasCanvasTouched) {
        event.preventDefault();
        this._strokeEnd(event);
      }
    };

    this.on();

    this.on.bind(this);
    this.clear.bind(this);
  }

  clear() {
    const ctx = this._ctx;
    const canvas = this._canvas;

    ctx.fillStyle = this.backgroundColor;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this._data = [];
    this._reset();
    this._isEmpty = true;
  }

  fromDataURL(dataUrl) {
    const image = new Image();
    const ratio = window.devicePixelRatio || 1;
    const width = this._canvas.width / ratio;
    const height = this._canvas.height / ratio;

    this._reset();
    image.src = dataUrl;
    image.on = () => this._ctx.drawImage(image, 0, 0, width, height);
    this._isEmpty = false;
  }

  toDataURL(type) {
    let _canvas;

    switch (type) {
      case 'image/svg+xml':
        return this._toSVG();
      default:
        let _len = arguments.length;
        let options = Array(_len > 1 ? _len - 1 : 0);

        for (
          // var _len = arguments.length,
          //   options = Array(_len > 1 ? _len - 1 : 0),
          let _key = 1; _key < _len; _key++
        ) {
          options[_key - 1] = arguments[_key];
        }

        return (_canvas = this._canvas).toDataURL.apply(_canvas, [type].concat(options));
    }
  }

  on() {
    this._handleMouseEvents();
    this._handleTouchEvents();
  }

  off() {
    this._canvas.removeEventListener('mousedown', this._handleMouseDown);
    this._canvas.removeEventListener('mousemove', this._handleMouseMove);
    document.removeEventListener('mouseup', this._handleMouseUp);

    this._canvas.removeEventListener('touchstart', this._handleTouchStart);
    this._canvas.removeEventListener('touchmove', this._handleTouchMove);
    this._canvas.removeEventListener('touchend', this._handleTouchEnd);
  }

  isEmpty() {
    return this._isEmpty;
  }

  _strokeBegin(event) {
    this._data.push([]);
    this._reset();
    this._strokeUpdate(event);

    if (typeof this.onBegin === 'function') {
      this.onBegin(event);
    }
  }

  _strokeUpdate(event) {
    const x = event.clientX;
    const y = event.clientY;

    const point = this._createPoint(x, y);

    const {
      curve,
      widths
    } = this._addPoint(point);

    if (curve && widths) {
      this._drawCurve(curve, widths.start, widths.end);
    }

    this._data[this._data.length - 1].push({
      x: point.x,
      y: point.y,
      time: point.time,
    });
  }

  _strokeEnd(event) {
    const canDrawCurve = this.points.length > 2;
    const point = this.points[0];

    if (!canDrawCurve && point) {
      this._drawDot(point);
    }

    if (typeof this.onEnd === 'function') {
      this.onEnd(event);
    }
  }

  _handleMouseEvents() {
    this._mouseButtonDown = false;

    this._canvas.addEventListener('mousedown', this._handleMouseDown);
    this._canvas.addEventListener('mousemove', this._handleMouseMove);
    this._canvas.addEventListener('mouseup', this._handleMouseUp);
  }

  _handleTouchEvents() {
    // Pass touch events to canvas element on mobile IE11 and Edge.
    this._canvas.style.msTouchAction = 'none';
    this._canvas.style.touchAction = 'none';

    this._canvas.addEventListener('touchstart', this._handleTouchStart);
    this._canvas.addEventListener('touchmove', this._handleTouchMove);
    this._canvas.addEventListener('touchend', this._handleTouchEnd);
  }

  _reset() {
    this.points = [];
    this._lastVelocity = 0;
    this._lastWidth = (this.minWidth + this.maxWidth) / 2;
    this._ctx.fillStyle = this.penColor;
  }

  _createPoint(x, y, time) {
    const rect = this._canvas.getBoundingClientRect();

    return new Point(x - rect.left, y - rect.top, time || new Date().getTime());
  }

  _addPoint(point) {
    const points = this.points;
    let tmp = void 0;

    points.push(point);

    if (points.length > 2) {
      // to reduce the initial lag make it work with 3 points
      // by copying the first point to the beginning.
      if (points.length === 3) points.unshift(points[0]);

      tmp = this._calculateCurveControlPoints(points[0], points[1], points[2]);
      let c2 = tmp.c2;
      tmp = this._calculateCurveControlPoints(points[1], points[2], points[3]);
      let c3 = tmp.c1;
      const curve = new Bezier(points[1], c2, c3, points[2]);
      const widths = this._calculateCurveWidths(curve);

      // remove the first element from the list,
      // so that we always have no more than 4 points in points array.
      points.shift();

      return {
        curve,
        widths
      };
    }

    return {};
  }

  _calculateCurveControlPoints(s1, s2, s3) {
    const dx1 = s1.x - s2.x;
    const dy1 = s1.y - s2.y;
    const dx2 = s2.x - s3.x;
    const dy2 = s2.y - s3.y;

    const m1 = {
      x: (s1.x + s2.x) / 2.0,
      y: (s1.y + s2.y) / 2.0,
    };
    const m2 = {
      x: (s2.x + s3.x) / 2.0,
      y: (s2.y + s3.y) / 2.0,
    };

    const l1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
    const l2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

    const dxm = m1.x - m2.x;
    const dym = m1.y - m2.y;

    const k = l2 / (l1 + l2);
    const cm = {
      x: m2.x + dxm * k,
      y: m2.y + dym * k,
    };

    const tx = s2.x - cm.x;
    const ty = s2.y - cm.y;

    return {
      c1: new Point(m1.x + tx, m1.y + ty),
      c2: new Point(m2.x + tx, m2.y + ty),
    };
  }

  _calculateCurveWidths({
    startPoint,
    endPoint
  }) {
    const widths = {
      start: null,
      end: null
    };
    const velocity = this.velocityFilterWeight * endPoint.velocityFrom(startPoint) + (1 - this.velocityFilterWeight) * this._lastVelocity;
    const newWidth = this._strokeWidth(velocity);

    widths.start = this._lastWidth;
    widths.end = newWidth;

    this._lastVelocity = velocity;
    this._lastWidth = newWidth;

    return widths;
  }

  _strokeWidth(velocity) {
    return Math.max(this.maxWidth / (velocity + 1), this.minWidth);
  }

  _drawPoint(x, y, size) {
    const ctx = this._ctx;

    ctx.moveTo(x, y);
    ctx.arc(x, y, size, 0, 2 * Math.PI, false);
    this._isEmpty = false;
  }

  // DEBUG
  drawDataAsPoints(size, fill) {
    const ctx = this._ctx;
    ctx.save();

    const length = this._data.length;if (length) {
      for (let i = 0; i < length; i += 1) {
        for (let j = 0; j < this._data[i].length; j += 1) {
          var point = this._data[i][j];
          const { x, y } = point;
          ctx.moveTo(x, y);
          ctx.arc(x, y, size || 5, 0, 2 * Math.PI, false);
          ctx.fillStyle = fill || 'rgba(255, 0, 0, 0.2)';
          ctx.fill();
        }
      }
    }

    ctx.restore();
  }

  _drawMark(x, y, size, fill) {
    const ctx = this._ctx;
    ctx.save();
    ctx.moveto(x, y);
    ctx.arc(x, y, size || 5, 0, 2 * Math.PI, false);
    ctx.fillStyle = fill || 'rgba(255, 0, 0, 0.2)';
    ctx.fill();
    ctx.restore();
  }

  _drawCurve(curve, startWidth, endWidth) {
    const ctx = this._ctx;
    const widthDelta = endWidth - startWidth;
    const drawSteps = Math.floor(curve.length());

    ctx.beginPath();

    for (let i = 0; i < drawSteps; i += 1) {
      // calculate the Bezier (x, y) coordinate for this step
      const t = i / drawSteps;
      const tt = t * t;
      const ttt = tt * t;
      const u = 1 - t;
      const uu = u * u;
      const uuu = uu * u;

      let x = uuu * curve.startPoint.x;
      x += 3 * uu * t * curve.control1.x;
      x += 3 * u * tt * curve.control2.x;
      x += ttt * curve.endPoint.x;

      let y = uuu * curve.startPoint.y;
      y += 3 * uu * t * curve.control1.y;
      y += 3 * u * tt * curve.control2.y;
      y += ttt * curve.endPoint.y;

      const width = startWidth + ttt * widthDelta;
      this._drawPoint(x, y, width);
    }

    ctx.closePath();
    ctx.fill();
  }

  _drawDot(point) {
    const ctx = this._ctx;
    const width = typeof this.dotSize === 'function' ? this.dotSize() : this.dotSize;

    ctx.beginPath();
    this._drawPoint(point.x, point.y, width);
    ctx.closePath();
    ctx.fill();
  }

  _fromData(pointGroups, drawCurve, drawDot) {
    for (let i = 0; i < pointGroups.length; i += 1) {
      const group = pointGroups[i];

      if (group.length > 1) {
        for (let j = 0; j < group.length; j += 1) {
          const rawPoint = group[j];
          const point = new Point(rawPoint.x, rawPoint.y, rawPoint.time);

          if (j === 0) {
            // first point in a group. nothing to draw yet.
            this._reset();
            this._addPoint(point);
          } else if (j !== group.length - 1) {
            // middle point in a group
            const {
              curve,
              widths
            } = this._addPoint(point);

            if (curve && widths) {
              drawCurve(curve, widths);
            }
          } else {
            // Last point in a group. Do nothing.
          }
        }
      } else {
        this._reset();
        const _rawPoint = group[0];
        drawDot(_rawPoint);
      }
    }
  }

  _toSVG() {
    const pointGroups = this._data;
    const canvas = this._canvas;
    let minX = 0;
    let minY = 0;
    let maxX = canvas.width;
    let maxY = canvas.height;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttributeNS(null, 'width', canvas.width);
    svg.setAttributeNS(null, 'height', canvas.height);

    this._fromData(pointGroups, (curve, widths) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

      // need to check curve for NaN values, these pop up when drawing
      // lines on the canvas that are not continuous. E.g. Sharp corners
      // or stopping mid-stroke and then continuing without lifting mouse.
      if (!isNaN(curve.control1.x) && !isNaN(curve.control1.y) && !isNaN(curve.control2.x) && !isNaN(curve.control2.y)) {
        const attr = `M ${curve.startPoint.x.toFixed(3)},${curve.startPoint.y.toFixed(3)} C ${curve.control1.x.toFixed(3)},${curve.control1.y.toFixed(3)} ${curve.control2.x.toFixed(3)},${curve.control2.y.toFixed(3)} ${curve.endPoint.x.toFixed(3)},${curve.endPoint.y.toFixed(3)}`;

        path.setAttribute('d', attr);
        path.setAttributeNS(null, 'stroke-width', (widths.end * 2.25).toFixed(3));
        path.setAttributeNS(null, 'stroke', this.penColor);
        path.setAttributeNS(null, 'fill', 'none');
        path.setAttributeNS(null, 'stroke-linecap', 'round');

        svg.appendChild(path);
      }
    }, (rawPoint) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const dotSize = typeof this.dotSize === 'function' ? this.dotSize() : this.dotSize;
      circle.setAttributeNS(null, 'r', dotSize);
      circle.setAttributeNS(null, 'cx', rawPoint.x);
      circle.setAttributeNS(null, 'cy', rawPoint.y);
      circle.setAttributeNS(null, 'fill', this.penColor);

      svg.appendChild(circle);
    });

    const prefix = 'data:image/svg+xml;base64,';
    const header = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${minX} ${minY} ${maxX} ${maxY}">`;
    const body = svg.innerHTML;
    const footer = '</svg>';
    const data = header + body + footer;

    return prefix + btoa(data);
  }

  fromData(pointGroups) {
    this.clear();
    this._fromData(pointGroups, (curve, widths) => {
      return this._drawCurve(curve, widths.start, widths.end);
    }, (rawPoint) => {
      return this._drawDot(rawPoint);
    });
  }

  toData() {
    return this._data;
  }
}