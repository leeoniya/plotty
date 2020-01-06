import {
	copy,

	inf,
	abs,
	floor,
	round,
	round2,
	ceil,
	min,
	max,
	clamp,
	pow,
	log10,
	debounce,
	closestIdx,
	getMinMax,
	rangeNum,
	incrRoundUp,
	incrRoundDn,
	assign,
	isArr,
	isStr,
	fnOrSelf,
} from './utils';

import {
	WIDTH,
	HEIGHT,
	TOP,
	BOTTOM,
	LEFT,
	RIGHT,
	hexBlack,
	firstChild,
	nextSibling,

	mousemove,
	mousedown,
	mouseup,
	mouseleave,
	dblclick,
	resize,
	scroll,
} from './strings';

import {
	rAF,
	doc,
	win,
	pxRatio,

	addClass,
	remClass,
	setStylePx,
	makeCanvas,
	placeTag,
	placeDiv,
	clearFrom,
	trans,
	on,
	off,
} from './dom';

import {
	xAxisOpts,
	yAxisOpts,
	xSeriesOpts,
	ySeriesOpts,
	xScaleOpts,
	yScaleOpts,

	timeIncrs,
	intIncrs,
	numIncrs,
	timeAxisVals,
	numAxisVals,

	timeSeriesVal,
	numSeriesVal,

	timeSeriesLabel,
	numSeriesLabel,

	timeAxisTicks,
	numAxisTicks,

	timeAxisStamps,
	_timeAxisStamps,

	timeSeriesStamp,
	_timeSeriesStamp,
} from './opts';

import {
	_sync,
	syncs,
} from './sync';

function log(name, args) {
	console.log.apply(console, [name].concat(Array.prototype.slice.call(args)));
}

function setDefaults(d, xo, yo) {
	return [d[0], d[1]].concat(d.slice(2)).map((o, i) => assign({}, (i == 0 || o && o.side % 2 == 0 ? xo : yo), o));
}

function getYPos(val, scale, hgt) {
	let pctY = (val - scale.min) / (scale.max - scale.min);
	return (1 - pctY) * hgt;
}

function getXPos(val, scale, wid) {
	let pctX = (val - scale.min) / (scale.max - scale.min);
	return pctX * wid;
}

function snapNone(self, dataMin, dataMax) {
	return [dataMin, dataMax];
}

// this ensures that non-temporal/numeric y-axes get multiple-snapped padding added above/below
// TODO: also account for incrs when snapping to ensure top of axis gets a tick & value
function snapFifthMag(self, dataMin, dataMax) {
	return rangeNum(dataMin, dataMax, 0.2, true);
}

// dim is logical (getClientBoundingRect) pixels, not canvas pixels
function findIncr(valDelta, incrs, dim, minSpace) {
	let pxPerUnit = dim / valDelta;

	for (var i = 0; i < incrs.length; i++) {
		let space = incrs[i] * pxPerUnit;

		if (space >= minSpace)
			return [incrs[i], space];
	}
}

function filtMouse(e) {
	return e.button == 0;
}

export function Line(opts, data, ready) {
	opts = copy(opts);

	const self = this;

	const series  = setDefaults(opts.series, xSeriesOpts, ySeriesOpts);
	const axes    = setDefaults(opts.axes || [], xAxisOpts, yAxisOpts);
	const scales  = (opts.scales = opts.scales || {});

	const spanGaps = opts.spanGaps || false;

	const gutters = assign({x: yAxisOpts.size, y: xAxisOpts.size}, opts.gutters);

//	self.tz = opts.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
	const tzDate = opts.tzDate || (ts => new Date(ts * 1e3));

	const _timeAxisTicks = timeAxisTicks(tzDate);
	const _timeAxisVals = timeAxisVals(tzDate, _timeAxisStamps);
	const _timeSeriesVal = timeSeriesVal(tzDate, _timeSeriesStamp);

	self.series = series;
	self.axes = axes;
	self.scales = scales;

	const pendScales = {};

	// explicitly-set initial scales
	for (let k in scales) {
		let sc = scales[k];

		if (sc.min != null || sc.max != null)
			pendScales[k] = {min: sc.min, max: sc.max};
	}

	const legendOpts = assign({show: true}, opts.legend);

	// set default value
	series.forEach((s, i) => {
		// init scales & defaults
		const scKey = s.scale;

		const sc = scales[scKey] = assign({}, (i == 0 ? xScaleOpts : yScaleOpts), scales[scKey]);

		let isTime = sc.time;

		sc.range = fnOrSelf(sc.range || (i > 0 && !isTime ? snapFifthMag : snapNone));

		let sv = s.value;
		s.value = isTime ? (isStr(sv) ? timeSeriesVal(tzDate, timeSeriesStamp(sv)) : sv || _timeSeriesVal) : sv || numSeriesVal;
		s.label = s.label || (isTime ? timeSeriesLabel : numSeriesLabel);
		s.width = s.width || 1;
	});

	// dependent scales inherit
	for (let k in scales) {
		let sc = scales[k];

		if (sc.from != null)
			scales[k] = assign({}, scales[sc.from], sc);
	}

	const xScaleKey = series[0].scale;
	const xScaleDistr = scales[xScaleKey].distr;

	let dataLen;

	// rendered data window
	let i0 = null;
	let i1 = null;

	let data0 = null;

	function setData(_data, _autoScaleX) {
		self.data = _data;
		data = _data.slice();
		data0 = data[0];
		dataLen = data0.length;

		if (xScaleDistr == 2)
			data[0] = data0.map((v, i) => i);

		resetYSeries();

		fire("setData");

		let xsc = scales[xScaleKey];

		let _min = xsc.min,
			_max = xsc.max;

		if (_autoScaleX !== false) {
			i0 = 0;
			i1 = dataLen - 1;

			_min = xScaleDistr == 2 ? i0 : data[0][i0];
			_max = xScaleDistr == 2 ? i1 : data[0][i1];
		}

		_setScale(xScaleKey, _min, _max);
	}

	self.setData = setData;

	function setCtxStyle(color, width, dash, fill) {
		ctx.strokeStyle = color || hexBlack;
		ctx.lineWidth = width || 1;
		ctx.lineJoin = "round";
		ctx.setLineDash(dash || []);
		ctx.fillStyle = fill || hexBlack;
	}

	const root = placeDiv("uplot");

	if (opts.id != null)
		root.id = opts.id;

	addClass(root, opts.class);

	if (opts.title != null) {
		let title = placeDiv("title", root);
		title.textContent = opts.title;
	}

	const wrap = placeDiv("wrap", root);

	const plot = placeDiv("plot", wrap);

	let fullCssWidth = opts[WIDTH];
	let fullCssHeight = opts[HEIGHT];

	let canCssWidth = fullCssWidth;
	let canCssHeight = fullCssHeight;

	// plot margins to account for axes
	let plotLft = 0;
	let plotTop = 0;

	// easement for rightmost x label if no right y axis exists
	let hasRightAxis = false;
	let hasLeftAxis = false;

	// accumulate axis offsets, reduce canvas width
	axes.forEach((axis, i) => {
		if (!axis.show)
			return;

		let {side, size} = axis;
		let isVt = side % 2;
		let labelSize = axis.labelSize = (axis.label != null ? (axis.labelSize || 30) : 0);

		let fullSize = size + labelSize;

		if (isVt) {
			canCssWidth -= fullSize;

			if (side == 3) {
				plotLft += fullSize;
				hasLeftAxis = true;
			}
			else
				hasRightAxis = true;
		}
		else {
			canCssHeight -= fullSize;

			if (side == 0)
				plotTop += fullSize;
		}

		let sc = scales[axis.scale];

		// this can occur if all series specify non-default scales
		if (sc == null) {
			axis.scale = isVt ? series[1].scale : xScaleKey;
			sc = scales[axis.scale];
		}

		// also set defaults for incrs & values based on axis distr
		let isTime = sc.time;

		axis.space = fnOrSelf(axis.space);
		axis.incrs = fnOrSelf(axis.incrs || (sc.distr == 2 ? intIncrs : (isTime ? timeIncrs : numIncrs)));
		axis.ticks = fnOrSelf(axis.ticks || (sc.distr == 1 && isTime ? _timeAxisTicks : numAxisTicks));
		let av = axis.values;
		axis.values = isTime ? (isArr(av) ? timeAxisVals(tzDate, timeAxisStamps(av)) : av || _timeAxisVals) : av || numAxisVals;
	});

	// hz gutters
	if (hasLeftAxis || hasRightAxis) {
		if (!hasRightAxis)
			canCssWidth -= gutters.x;
		if (!hasLeftAxis) {
			canCssWidth -= gutters.x;
			plotLft += gutters.x;
		}
	}

	// left & top axes are positioned using "right" & "bottom", so to go outwards from plot
	let off1 = fullCssWidth - plotLft;
	let off2 = fullCssHeight - plotTop;
	let off3 = plotLft + canCssWidth;
	let off0 = plotTop + canCssHeight;

	function placeAxisPart(aroot, prefix, side, isVt, size) {
		let el = placeDiv(prefix, aroot);

		if (isVt) {
			setStylePx(el, WIDTH, size);
			setStylePx(el, HEIGHT, canCssHeight);
			setStylePx(el, TOP, plotTop);

			if (side == 3) {
				setStylePx(el, RIGHT, off1);
				off1 += size;
			}
			else {
				setStylePx(el, LEFT, off3);
				off3 += size;
			}
		}
		else {
			setStylePx(el, HEIGHT, size);
			setStylePx(el, WIDTH, canCssWidth);
			setStylePx(el, LEFT, plotLft);

			if (side == 0) {
				setStylePx(el, BOTTOM, off2);
				off2 += size;
			}
			else {
				setStylePx(el, TOP, off0);
				off0 += size;
			}
		}

		return el;
	}

	// init axis containers, set axis positions
	axes.forEach((axis, i) => {
		if (!axis.show)
			return;

		let side = axis.side;
		let isVt = side % 2;

		let aroot = axis.root = placeDiv("axis-" + (isVt ? "y-" : "x-") + side, wrap);

		addClass(aroot, axis.class);
		aroot.style.color = axis.color;

		axis.vals = placeAxisPart(aroot, "values", side, isVt, axis.size);

		if (axis.label != null) {
			let lbl = placeAxisPart(aroot, "labels", side, isVt, axis.labelSize);
			let txt = placeDiv(null, lbl);
			txt.textContent = axis.label;
		}
	});

	setStylePx(plot, TOP, plotTop);
	setStylePx(plot, LEFT, plotLft);
	setStylePx(wrap, WIDTH, fullCssWidth);
	setStylePx(wrap, HEIGHT, fullCssHeight);

	const { can, ctx } = makeCanvas(canCssWidth, canCssHeight);

	self.ctx = ctx;

	plot.appendChild(can);

	function setScales() {
		if (inBatch) {
			shouldSetScales = true;
			return;
		}

	//	log("setScales()", arguments);

		// cache original scales' min/max & reset
		let minMaxes = {};

		for (let k in scales) {
			let sc = scales[k];
			let psc = pendScales[k];

			minMaxes[k] = {
				min: sc.min,
				max: sc.max
			};

			if (psc != null) {
				assign(sc, psc);

				// explicitly setting the x-scale invalidates everything (acts as redraw)
				if (k == xScaleKey)
					resetYSeries();
			}
			else if (k != xScaleKey) {
				sc.min = inf;
				sc.max = -inf;
			}
		}

		// pre-range y-scales from y series' data values
		series.forEach((s, i) => {
			let k = s.scale;
			let sc = scales[k];

			// setting the x scale invalidates everything
			if (i == 0) {
				i0 = closestIdx(sc.min, data[0]);
				i1 = closestIdx(sc.max, data[0]);

				// closest indices can be outside of view
				if (data[0][i0] < sc.min)
					i0++;
				if (data[0][i1] > sc.max)
					i1--;

				s.min = data0[i0];
				s.max = data0[i1];

				let minMax = sc.range(self, sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}
			else if (s.show && pendScales[k] == null) {
				// only run getMinMax() for invalidated series data, else reuse
				let minMax = s.min == inf ? (sc.auto ? getMinMax(data[i], i0, i1) : [0,100]) : [s.min, s.max];

				// initial min/max
				sc.min = min(sc.min, s.min = minMax[0]);
				sc.max = max(sc.max, s.max = minMax[1]);
			}
		});

		// snap non-dependent scales
		for (let k in scales) {
			let sc = scales[k];

			if (sc.from == null && sc.min != inf && pendScales[k] == null) {
				let minMax = sc.range(self, sc.min, sc.max);

				sc.min = minMax[0];
				sc.max = minMax[1];
			}

			pendScales[k] = null;
		}

		// range dependent scales
		for (let k in scales) {
			let sc = scales[k];

			if (sc.from != null) {
				let base = scales[sc.from];

				if (base.min != inf) {
					let minMax = sc.range(self, base.min, base.max);
					sc.min = minMax[0];
					sc.max = minMax[1];
				}
			}
		}

		let changed = {};

		// invalidate paths of all series on changed scales
		series.forEach((s, i) => {
			let k = s.scale;
			let sc = scales[k];

			if (minMaxes[k] != null && (sc.min != minMaxes[k].min || sc.max != minMaxes[k].max)) {
				changed[k] = true;
				s.path = null;
			}
		});

		for (let k in changed)
			fire("setScale", k);

		cursor.show && updateCursor();
	}

	let dir = 1;

	function drawSeries() {
		series.forEach((s, i) => {
			if (i > 0 && s.show && s.path == null)
				buildPath(i, data[0], data[i], scales[xScaleKey], scales[s.scale]);
		});

		series.forEach((s, i) => {
			if (i > 0 && s.show) {
				drawPath(i);
				fire("drawSeries", i);
			}
		});
	}

	function drawPath(is) {
		const s = series[is];

		if (dir == 1) {
			const path = s.path;
			const width = s[WIDTH];
			const offset = (width % 2) / 2;

			setCtxStyle(s.color, width, s.dash, s.fill);

			ctx.globalAlpha = s.alpha;

			ctx.translate(offset, offset);

			if (s.band)
				ctx.fill(path);
			else {
				ctx.stroke(path);

				if (s.fill != null) {
					let zeroY = round(getYPos(0, scales[s.scale], can[HEIGHT]));

					path.lineTo(can[WIDTH], zeroY);
					path.lineTo(0, zeroY);
					ctx.fill(path);
				}
			}

			ctx.translate(-offset, -offset);

			ctx.globalAlpha = 1;
		}

		if (s.band)
			dir *= -1;
	}

	function buildPath(is, xdata, ydata, scaleX, scaleY) {
		const s = series[is];
		const path = s.path = dir == 1 ? new Path2D() : series[is-1].path;
		const width = s[WIDTH];

		let gap = false;

		let minY = inf,
			maxY = -inf,
			x, y;

		let _i0 = clamp(i0 - 1, 0, dataLen - 1);
		let _i1 = clamp(i1 + 1, 0, dataLen - 1);

		let prevX = round(getXPos(xdata[dir == 1 ? _i0 : _i1], scaleX, can[WIDTH])),
			prevY;

		for (let i = dir == 1 ? _i0 : _i1; dir == 1 ? i <= _i1 : i >= _i0; i += dir) {
			x = round(getXPos(xdata[i], scaleX, can[WIDTH]));
			y = round(getYPos(ydata[i], scaleY, can[HEIGHT]));

			if (dir == -1 && i == _i1)
				path.lineTo(x, y);

			if (ydata[i] == null)
				gap = true;
			else {
				if ((dir == 1 ? x - prevX : prevX - x) >= width) {
					if (gap) {
						spanGaps ? path.lineTo(x, y) : path.moveTo(x, y);	// bug: will break filled areas due to moveTo
						gap = false;
					}
					else if (dir == 1 ? i > _i0 : i < _i1) {
						path.lineTo(prevX, maxY);		// cannot be moveTo if we intend to fill the path
						path.lineTo(prevX, minY);
						path.lineTo(prevX, prevY);		// cannot be moveTo if we intend to fill the path
						path.lineTo(x, y);
					}

					minY = maxY = y;
					prevX = x;
				}
				else {
					minY = min(y, minY);
					maxY = max(y, maxY);
				}

				prevY = y;
			}
		}

		if (s.band) {
			if (dir == -1)
				path.closePath();

			dir *= -1;
		}
	}

	function drawAxesGrid() {
		axes.forEach((axis, i) => {
			if (!axis.show)
				return;

			let scale = scales[axis.scale];

			// this will happen if all series using a specific scale are toggled off
			if (scale.min == inf) {
				addClass(axis.root, "off");
				return;
			}

			remClass(axis.root, "off");

			let ori = axis.side % 2;
			let dim = ori == 0 ? WIDTH : HEIGHT;
			let canDim = ori == 0 ? canCssWidth : canCssHeight;

			let {min, max} = scale;

			let minSpace = axis.space(self, min, max, canDim);

			let [incr, space] = findIncr(max - min, axis.incrs(self), canDim, minSpace);

			// if we're using index positions, force first tick to match passed index
			let forceMin = scale.distr == 2;

			let ticks = axis.ticks(self, min, max, incr, space/minSpace, forceMin);

			let getPos = ori == 0 ? getXPos : getYPos;
			let cssProp = ori == 0 ? LEFT : TOP;

			// TODO: filter ticks & offsets that will end up off-canvas
			let canOffs = ticks.map(val => round2(getPos(val, scale, can[dim])));		// bit of waste if we're not drawing a grid

			let values = axis.values(self, scale.distr == 2 ? ticks.map(i => data0[i]) : ticks, space);		// BOO this assumes a specific data/series

			let ch = axis.vals[firstChild];

			canOffs.forEach((off, i) => {
				let div = ch || placeDiv(null, axis.vals);
				div.textContent = values[i];
				setStylePx(div, cssProp, round(off/pxRatio));
				ch = div[nextSibling];
			});

			ch && clearFrom(ch);

			let grid = axis.grid;

			if (grid.show) {
				// note: the grid is cheap to build & redraw unconditionally, so does not
				// use the retained Path2D optimization or additional invalidation logic
				let offset = (grid[WIDTH] % 2) / 2;
				ctx.translate(offset, offset);

				setCtxStyle(grid.color || "#eee", grid[WIDTH], grid.dash);

				ctx.beginPath();

				canOffs.forEach((off, i) => {
					let mx, my, lx, ly;

					if (ori == 0) {
						my = 0;
						ly = can[HEIGHT];
						mx = lx = off;
					}
					else {
						mx = 0;
						lx = can[WIDTH];
						my = ly = off;
					}

					ctx.moveTo(mx, my);
					ctx.lineTo(lx, ly);
				});

				ctx.stroke();

				ctx.translate(-offset, -offset);
			}
		});

		fire("drawGrid");
	}

	function resetYSeries() {
	//	log("resetYSeries()", arguments);

		series.forEach((s, i) => {
			if (i > 0) {
				s.min = inf;
				s.max = -inf;
				s.path = null;
			}
		});
	}

	let didPaint;

	function paint() {
		if (inBatch) {
			shouldPaint = true;
			return;
		}

	//	log("paint()", arguments);

		ctx.clearRect(0, 0, can[WIDTH], can[HEIGHT]);
		fire("drawClear");
		drawAxesGrid();
		drawSeries();
		didPaint = true;
		fire("draw");
	}

	self.redraw = paint;

	// redraw() => setScale('x', scales.x.min, scales.x.max);

	// explicit, never re-ranged
	function setScale(key, opts) {
		let sc = scales[key];

		if (sc.from == null) {
		//	log("setScale()", arguments);

			pendScales[key] = opts;

			didPaint = false;
			setScales();
			!didPaint && paint();
			didPaint = false;
		}
	}

	self.setScale = setScale;

//	INTERACTION

	let vt;
	let hz;

	// starting position
	let mouseLeft0;
	let mouseTop0;

	// current position
	let mouseLeft1;
	let mouseTop1;

	let dragging = false;

	const cursor = self.cursor = assign({
		show: true,
		cross: true,
		lock: false,
		points: true,

		drag: {
			setScale: true,
			x: true,
			y: false,
		},

		locked: false,
		left: -10,
		top: -10,
		idx: null,
	}, opts.cursor);

	const focus = cursor.focus;		// focus: {alpha, prox}
	const drag = cursor.drag;

	if (cursor.show) {
		if (cursor.cross) {
			mouseLeft1 = cursor.left;
			mouseTop1 = cursor.top;

			let c = "cursor-";

			vt = placeDiv(c + "x", plot);
			hz = placeDiv(c + "y", plot);
		}
	}

	const select = placeDiv("select", plot);

	const _select = self.select = {
		left:	0,
		width:	0,
		top:	0,
		height:	0,
	};

	function setSelect(opts, _fire) {
		if (opts[WIDTH] == null && drag.y)
			opts[WIDTH] = canCssWidth;

		if (opts[HEIGHT] == null && drag.x)
			opts[HEIGHT] = canCssHeight;

		for (let prop in opts)
			setStylePx(select, prop, _select[prop] = opts[prop]);

		_fire !== false && fire("setSelect");
	}

	self.setSelect = setSelect;

	let legend = null;
	let legendRows = null;
	let multiValLegend = false;

	if (legendOpts.show) {
		legend = placeTag("table", "legend", root);

		let vals = series[1].values;
		multiValLegend = vals != null;

		let keys;

		if (multiValLegend) {
			let head = placeTag("tr", "labels", legend);
			placeTag("th", null, head);
			keys = vals(0);

			for (var key in keys)
				placeTag("th", null, head).textContent = key;
		}
		else {
			keys = {_: 0};
			addClass(legend, "inline");
		}

		legendRows = series.map((s, i) => {
			if (i == 0 && multiValLegend)
				return null;

			let _row = [];

			let row = placeTag("tr", "series", legend);

			addClass(row, s.class);

			if (!s.show)
				addClass(row, "off");

			let label = placeTag("th", null, row);
			label.textContent = s.label;

			label.style.color = s.color;

			if (i > 0) {
				on("click", label, e => {
					if (cursor.locked)
						return;

					filtMouse(e) && setSeries(i, {show: !s.show}, syncOpts.setSeries);
				});

				if (focus) {
					on("mouseenter", label, e => {
						if (cursor.locked)
							return;

						setSeries(i, {focus: true}, syncOpts.setSeries);
					});
				}
			}

			for (var key in keys) {
				let v = placeTag("td", null, row);
				v.textContent = "--";
				_row.push(v);
			}

			return _row;
		});
	}

	function toggleDOM(i, onOff) {
		let s = series[i];
		let label = legendRows[i][0].parentNode;

		if (s.show)
			remClass(label, "off");
		else {
			addClass(label, "off");
			showPoints && trans(cursorPts[i], 0, -10)
		}
	}

	function _setScale(key, min, max) {
		setScale(key, {min, max});
	}

	function setSeries(i, opts, pub) {
	//	log("setSeries()", arguments);

		let s = series[i];

	//	batch(() => {
			// will this cause redundant paint() if both show and focus are set?
			if (opts.focus != null)
				setFocus(i);

			if (opts.show != null) {
				s.show = opts.show;
				toggleDOM(i, opts.show);

				if (s.band) {
					// not super robust, will break if two bands are adjacent
					let ip = series[i+1].band ? i+1 : i-1;
					series[ip].show = s.show;
					toggleDOM(ip, opts.show);
				}

				_setScale(xScaleKey, scales[xScaleKey].min, scales[xScaleKey].max);		// redraw
			}
	//	});

		// firing setSeries after setScale seems out of order, but provides access to the updated props
		// could improve by predefining firing order and building a queue
		fire("setSeries", i, opts);

		pub && sync.pub("setSeries", self, i, opts);
	}

	self.setSeries = setSeries;

	function _alpha(i, value) {
		series[i].alpha = legendRows[i][0].parentNode.style.opacity = value;
	}

	function _setAlpha(i, value) {
		let s = series[i];

		_alpha(i, value);

		if (s.band) {
			// not super robust, will break if two bands are adjacent
			let ip = series[i+1].band ? i+1 : i-1;
			_alpha(ip, value);
		}
	}

	// y-distance
	const distsToCursor = Array(series.length);

	let focused = null;

	function setFocus(i) {
		if (i != focused) {
		//	log("setFocus()", arguments);

			series.forEach((s, i2) => {
				_setAlpha(i2, i == null || i2 == 0 || i2 == i ? 1 : focus.alpha);
			});

			focused = i;
			paint();
		}
	}

	if (focus) {
		on("mouseleave", legend, e => {
			if (cursor.locked)
				return;
			setSeries(null, {focus: false}, syncOpts.setSeries);
			updateCursor();
		});
	}

	let showPoints = cursor.show && cursor.points;

	// series-intersection markers
	const cursorPts = showPoints ? series.map((s, i) => {
		if (i > 0) {
			let pt = placeDiv("point", plot);

			addClass(pt, s.class);

			pt.style.background = s.color;

			let size = max(5, s.width * 2 - 1);
			let mar = (size - 1) / -2;

			setStylePx(pt, WIDTH, size);
			setStylePx(pt, HEIGHT, size);
			setStylePx(pt, "borderRadius", size);
			setStylePx(pt, "marginLeft", mar);
			setStylePx(pt, "marginTop", mar);

			trans(pt, -10, -10);
			return pt;
		}
	}) : null;

	let rafPending = false;

	function scaleValueAtPos(pos, scale) {
		let dim = scale == xScaleKey ? canCssWidth : canCssHeight;
		let pct = clamp(pos / dim, 0, 1);

		let sc = scales[scale];
		let d = sc.max - sc.min;
		return sc.min + pct * d;
	}

	function closestIdxFromXpos(pos) {
		let v = scaleValueAtPos(pos, xScaleKey);
		return closestIdx(v, data[0], i0, i1);
	}

	self.posToIdx = closestIdxFromXpos;
	self.posToVal = (pos, scale) => scaleValueAtPos(scale == xScaleKey ? pos : canCssHeight - pos, scale);
	self.valToPos = (val, scale) => (scale == xScaleKey ? round(getXPos(val, scales[scale], canCssWidth)) : round(getYPos(val, scales[scale], canCssHeight)));

	let inBatch = false;
	let shouldPaint = false;
	let shouldSetScales = false;
	let shouldUpdateCursor = false;

	// defers calling expensive functions
	function batch(fn) {
		inBatch = true;
		fn(self);
		inBatch = false;
		shouldSetScales && setScales();
		shouldUpdateCursor && updateCursor();
		shouldPaint && !didPaint && paint();
		shouldSetScales = shouldUpdateCursor = shouldPaint = didPaint = inBatch;
	}

	self.batch = batch;

	self.setCursor = opts => {
		mouseLeft1 = opts.left;
		mouseTop1 = opts.top;
	//	assign(cursor, opts);
		updateCursor();
	};

	function updateCursor(ts) {
		if (inBatch) {
			shouldUpdateCursor = true;
			return;
		}

	//	ts == null && log("updateCursor()", arguments);

		rafPending = false;

		if (cursor.show && cursor.cross) {
			trans(vt,round(mouseLeft1),0);
			trans(hz,0,round(mouseTop1));
		}

		let idx;

		// if cursor hidden, hide points & clear legend vals
		if (mouseLeft1 < 0) {
			idx = null;

			for (let i = 0; i < series.length; i++) {
				if (i > 0) {
					distsToCursor[i] = inf;
					showPoints && trans(cursorPts[i], -10, -10);
				}

				if (legendOpts.show) {
					if (i == 0 && multiValLegend)
						continue;

					for (let j = 0; j < legendRows[i].length; j++)
						legendRows[i][j][firstChild].nodeValue = '--';
				}
			}

			if (focus)
				setSeries(null, {focus: true}, syncOpts.setSeries);
		}
		else {
		//	let pctY = 1 - (y / rect[HEIGHT]);

			idx = closestIdxFromXpos(mouseLeft1);

			let scX = scales[xScaleKey];

			let xPos = round2(getXPos(data[0][idx], scX, canCssWidth));

			for (let i = 0; i < series.length; i++) {
				let s = series[i];

				if (i > 0 && s.show) {
					let yPos = round2(getYPos(data[i][idx], scales[s.scale], canCssHeight));

					if (yPos == null)
						yPos = -10;

					distsToCursor[i] = yPos > 0 ? abs(yPos - mouseTop1) : inf;

					showPoints && trans(cursorPts[i], xPos, yPos);
				}
				else
					distsToCursor[i] = inf;

				if (legendOpts.show) {
					if (i == 0 && multiValLegend)
						continue;

					let src = i == 0 && xScaleDistr == 2 ? data0 : data[i];

					let vals = multiValLegend ? s.values(self, idx) : {_: s.value(self, src[idx])};

					let j = 0;

					for (let k in vals)
						legendRows[i][j++][firstChild].nodeValue = vals[k];
				}
			}

			if (dragging) {
				// setSelect should not be triggered on move events
				if (drag.x) {
					let minX = min(mouseLeft0, mouseLeft1);
					let maxX = max(mouseLeft0, mouseLeft1);
					setStylePx(select, LEFT, _select[LEFT] = minX);
					setStylePx(select, WIDTH, _select[WIDTH] = maxX - minX);
				}

				if (drag.y) {
					let minY = min(mouseTop0, mouseTop1);
					let maxY = max(mouseTop0, mouseTop1);
					setStylePx(select, TOP, _select[TOP] = minY);
					setStylePx(select, HEIGHT, _select[HEIGHT] = maxY - minY);
				}
			}
		}

		// if ts is present, means we're implicitly syncing own cursor as a result of debounced rAF
		if (ts != null) {
			// this is not technically a "mousemove" event, since it's debounced, rename to setCursor?
			// since this is internal, we can tweak it later
			sync.pub(mousemove, self, mouseLeft1, mouseTop1, canCssWidth, canCssHeight, idx);

			if (focus) {
				let minDist = min.apply(null, distsToCursor);

				let fi = null;

				if (minDist <= focus.prox) {
					distsToCursor.some((dist, i) => {
						if (dist == minDist)
							return fi = i;
					});
				}

				setSeries(fi, {focus: true}, syncOpts.setSeries);
			}
		}

		cursor.idx = idx;
		cursor.left = mouseLeft1;
		cursor.top = mouseTop1;

		fire("setCursor");
	}

	let rect = null;

	function syncRect() {
		rect = can.getBoundingClientRect();
	}

	function mouseMove(e, src, _x, _y, _w, _h, _i) {
		if (cursor.locked)
			return;

		if (rect == null)
			syncRect();

		cacheMouse(e, src, _x, _y, _w, _h, _i, false);

		if (e != null) {
			if (!rafPending) {
				rafPending = true;
				rAF(updateCursor);
			}
		}
		else
			updateCursor();
	}

	function cacheMouse(e, src, _x, _y, _w, _h, _i, initial) {
		if (e != null) {
			_x = e.clientX - rect.left;
			_y = e.clientY - rect.top;
		}
		else {
			_x = canCssWidth * (_x/_w);
			_y = canCssHeight * (_y/_h);
		}

		if (initial) {
			mouseLeft0 = _x;
			mouseTop0 = _y;
		}
		else {
			mouseLeft1 = _x;
			mouseTop1 = _y;
		}
	}

	function hideSelect() {
		setSelect({
			width:	!drag.x ? canCssWidth : 0,
			height:	!drag.y ? canCssHeight : 0,
		}, false);
	}

	function mouseDown(e, src, _x, _y, _w, _h, _i) {
		if (e == null || filtMouse(e)) {
			dragging = true;

			cacheMouse(e, src, _x, _y, _w, _h, _i, true);

			if (drag.x || drag.y)
				hideSelect();

			if (e != null) {
				on(mouseup, doc, mouseUp);
				sync.pub(mousedown, self, mouseLeft0, mouseTop0, canCssWidth, canCssHeight, null);
			}
		}
	}

	function mouseUp(e, src, _x, _y, _w, _h, _i) {
		if ((e == null || filtMouse(e))) {
			dragging = false;

			cacheMouse(e, src, _x, _y, _w, _h, _i, false);

			if (mouseLeft1 != mouseLeft0 || mouseTop1 != mouseTop0) {
				setSelect(_select);

				if (drag.setScale) {
					batch(() => {
						if (drag.x) {
							let fn = xScaleDistr == 2 ? closestIdxFromXpos : scaleValueAtPos;

							_setScale(xScaleKey,
								fn(_select[LEFT], xScaleKey),
								fn(_select[LEFT] + _select[WIDTH], xScaleKey),
							);
						}

						if (drag.y) {
							for (let k in scales) {
								let sc = scales[k];

								if (k != xScaleKey && sc.from == null) {
									_setScale(k,
										scaleValueAtPos(canCssHeight - _select[TOP] - _select[HEIGHT], k),
										scaleValueAtPos(canCssHeight - _select[TOP], k),
									);
								}
							}
						}
					});

					hideSelect();
				}
			}
			else if (cursor.lock) {
				cursor.locked = !cursor.locked

				if (!cursor.locked)
					updateCursor();
			}

			if (e != null) {
				off(mouseup, doc, mouseUp);
				sync.pub(mouseup, self, mouseLeft1, mouseTop1, canCssWidth, canCssHeight, null);
			}
		}
	}

	function mouseLeave(e, src, _x, _y, _w, _h, _i) {
		if (!cursor.locked && !dragging) {
			mouseLeft1 = -10;
			mouseTop1 = -10;
			// passing a non-null timestamp to force sync/mousemove event
			updateCursor(1);
		}
	}

	function dblClick(e, src, _x, _y, _w, _h, _i) {
		fire("beginDblClick");
		let min = data[0][0];
		let max = data[0][dataLen - 1];
	//	let sc = scales[xScaleKey];

	//	if (min != sc.min || max != sc.max) {
			_setScale(xScaleKey, min, max);

			if (e != null)
				sync.pub(dblclick, self, mouseLeft1, mouseTop1, canCssWidth, canCssHeight, null);
	//	}
	}

	// internal pub/sub
	const events = {};

	events[mousedown] = mouseDown;
	events[mousemove] = mouseMove;
	events[mouseup] = mouseUp;
	events[dblclick] = dblClick;
	events["setSeries"] = (e, src, idx, opts) => {
		setSeries(idx, opts);
	};

	let deb;

	if (cursor.show) {
		on(mousedown, can, mouseDown);
		on(mousemove, can, mouseMove);
		on(mouseleave, can, mouseLeave);
		on(dblclick, can, dblClick);

		deb = debounce(syncRect, 100);

		on(resize, win, deb);
		on(scroll, win, deb);
	}

	self.root = root;

	// external on/off
	const hooks = self.hooks = opts.hooks || {};

	const evArg0 = [self];

	function fire(evName) {
		if (evName in hooks) {
			let args2 = evArg0.concat(Array.prototype.slice.call(arguments, 1));

			hooks[evName].forEach(fn => {
				fn.apply(null, args2);
			});
		}
	}

	(opts.plugins || []).forEach(phooks => {
		for (let evName in phooks)
			hooks[evName] = (hooks[evName] || []).concat(phooks[evName]);
	});

	const syncOpts = assign({
		key: null,
		setSeries: false,
	}, cursor.sync);

	const syncKey = syncOpts.key;

	const sync = syncKey != null ? (syncs[syncKey] = syncs[syncKey] || _sync()) : _sync();

	sync.sub(self);

	function pub(type, src, x, y, w, h, i) {
		events[type](null, src, x, y, w, h, i);
	}

	self.pub = pub;

	function destroy() {
		sync.unsub(self);
		off(resize, win, deb);
		off(scroll, win, deb);
		root.remove();
		fire("destroy");
	}

	self.destroy = destroy;

	function _init() {
		fire("init", opts, data);

		setData(
			data || opts.data,
			pendScales[xScaleKey] == null,
		);

		setSelect(_select);
	}

	if (ready) {
		if (ready instanceof HTMLElement) {
			ready.appendChild(root);
			_init();
		}
		else
			ready(self, _init);
	}
	else
		_init();
}