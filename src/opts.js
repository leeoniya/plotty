import {
	assign,

	inf,
	pow,
	log2,
	log10,
	genIncrs,
	abs,
	max,
	incrRoundUp,
	round,
	roundDec,
	floor,
	fmtNum,
	fixedDec,

	retArg1,
} from './utils';

import {
	hexBlack,
	WIDTH,
	HEIGHT,
} from './strings';

import {
	pxRatio,
	placeDiv,
	setStylePx,
} from './dom';

import {
	fmtDate,
	getFullYear,
	getMonth,
	getDate,
	getHours,
	getMinutes,
	getSeconds,
} from './fmtDate';

//export const series = [];

// default formatters:

const incrMults = [1,2,5];

const decIncrs = genIncrs(10, -16, 0, incrMults);

// base 2
const binIncrs = genIncrs(2, -53, 53, [1]);

export const intIncrs = genIncrs(10, 0, 16, incrMults);

export const numIncrs = decIncrs.concat(intIncrs);

let s = 1,
	m = 60,
	h = m * m,
	d = h * 24,
	mo = d * 30,
	y = d * 365;

// min of 1e-3 prevents setting a temporal x ticks too small since Date objects cannot advance ticks smaller than 1ms
export const timeIncrs = FEAT_TIME && genIncrs(10, -3, 0, incrMults).concat([
	// minute divisors (# of secs)
	1,
	5,
	10,
	15,
	30,
	// hour divisors (# of mins)
	m,
	m * 5,
	m * 10,
	m * 15,
	m * 30,
	// day divisors (# of hrs)
	h,
	h * 2,
	h * 3,
	h * 4,
	h * 6,
	h * 8,
	h * 12,
	// month divisors TODO: need more?
	d,
	d * 2,
	d * 3,
	d * 4,
	d * 5,
	d * 6,
	d * 7,
	d * 8,
	d * 9,
	d * 10,
	d * 15,
	// year divisors (# months, approx)
	mo,
	mo * 2,
	mo * 3,
	mo * 4,
	mo * 6,
	// century divisors
	y,
	y * 2,
	y * 5,
	y * 10,
	y * 25,
	y * 50,
	y * 100,
]);

export function timeAxisStamps(stampCfg, fmtDate) {
	return stampCfg.map(s => s.map((v, i) =>
		i == 0 || i == 8 || v == null ? v : fmtDate(i == 1 || s[8] == 0 ? v : s[1] + v)
	));
}

const NL = "\n";

const yyyy = "{YYYY}";
const NLyyyy = NL + yyyy;
const md = "{M}/{D}";
const NLmd = NL + md;
const NLmdyy = NLmd + "/{YY}";

const aa = "{aa}";
const hmm = "{h}:{mm}";
const hmmaa = hmm + aa;
const NLhmmaa = NL + hmmaa;
const ss = ":{ss}";

const _ = null;

// [0]:   minimum num secs in the tick incr
// [1]:   default tick format
// [2-7]: rollover tick formats
// [8]:   mode: 0: replace [1] -> [2-7], 1: concat [1] + [2-7]
export const _timeAxisStamps = [
//   tick incr    default          year                    month   day                   hour    min       sec   mode
	[y,           yyyy,            _,                      _,      _,                    _,      _,        _,       1],
	[d * 28,      "{MMM}",         NLyyyy,                 _,      _,                    _,      _,        _,       1],
	[d,           md,              NLyyyy,                 _,      _,                    _,      _,        _,       1],
	[h,           "{h}" + aa,      NLmdyy,                 _,      NLmd,                 _,      _,        _,       1],
	[m,           hmmaa,           NLmdyy,                 _,      NLmd,                 _,      _,        _,       1],
	[s,           ss,              NLmdyy + " " + hmmaa,   _,      NLmd + " " + hmmaa,   _,      NLhmmaa,  _,       1],
	[1e-3,        ss + ".{fff}",   NLmdyy + " " + hmmaa,   _,      NLmd + " " + hmmaa,   _,      NLhmmaa,  _,       1],
];

// TODO: will need to accept spaces[] and pull incr into the loop when grid will be non-uniform, eg for log scales.
// currently we ignore this for months since they're *nearly* uniform and the added complexity is not worth it
export function timeAxisVals(tzDate, stamps) {
	return (self, splits, axisIdx, foundSpace, foundIncr) => {
		let s = stamps.find(s => foundIncr >= s[0]) || stamps[stamps.length - 1];

		// these track boundaries when a full label is needed again
		let prevYear;
		let prevMnth;
		let prevDate;
		let prevHour;
		let prevMins;
		let prevSecs;

		return splits.map(split => {
			let date = tzDate(split);

			let newYear = date[getFullYear]();
			let newMnth = date[getMonth]();
			let newDate = date[getDate]();
			let newHour = date[getHours]();
			let newMins = date[getMinutes]();
			let newSecs = date[getSeconds]();

			let stamp = (
				newYear != prevYear && s[2] ||
				newMnth != prevMnth && s[3] ||
				newDate != prevDate && s[4] ||
				newHour != prevHour && s[5] ||
				newMins != prevMins && s[6] ||
				newSecs != prevSecs && s[7] ||
				                       s[1]
			);

			prevYear = newYear;
			prevMnth = newMnth;
			prevDate = newDate;
			prevHour = newHour;
			prevMins = newMins;
			prevSecs = newSecs;

			return stamp(date);
		});
	}
}

function mkDate(y, m, d) {
	return new Date(y, m, d);
}

// the ensures that axis ticks, values & grid are aligned to logical temporal breakpoints and not an arbitrary timestamp
// https://www.timeanddate.com/time/dst/
// https://www.timeanddate.com/time/dst/2019.html
// https://www.epochconverter.com/timezones
export function timeAxisSplits(tzDate) {
	return (self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace) => {
		let splits = [];
		let isYr = foundIncr >= y;
		let isMo = foundIncr >= mo && foundIncr < y;

		// get the timezone-adjusted date
		let minDate = tzDate(scaleMin);
		let minDateTs = minDate / 1e3;

		// get ts of 12am (this lands us at or before the original scaleMin)
		let minMin = mkDate(minDate[getFullYear](), isYr ? 0 : minDate[getMonth](), isMo || isYr ? 1 : minDate[getDate]());
		let minMinTs = minMin / 1e3;

		if (isMo || isYr) {
			let moIncr = isMo ? foundIncr / mo : 0;
			let yrIncr = isYr ? foundIncr / y  : 0;
		//	let tzOffset = scaleMin - minDateTs;		// needed?
			let split = minDateTs == minMinTs ? minDateTs : mkDate(minMin[getFullYear]() + yrIncr, minMin[getMonth]() + moIncr, 1) / 1e3;
			let splitDate = new Date(split * 1e3);
			let baseYear = splitDate[getFullYear]();
			let baseMonth = splitDate[getMonth]();

			for (let i = 0; split <= scaleMax; i++) {
				let next = mkDate(baseYear + yrIncr * i, baseMonth + moIncr * i, 1);
				let offs = next - tzDate(next / 1e3);

				split = (+next + offs) / 1e3;

				if (split <= scaleMax)
					splits.push(split);
			}
		}
		else {
			let incr0 = foundIncr >= d ? d : foundIncr;
			let tzOffset = floor(scaleMin) - floor(minDateTs);
			let split = minMinTs + tzOffset + incrRoundUp(minDateTs - minMinTs, incr0);
			splits.push(split);

			let date0 = tzDate(split);

			let prevHour = date0[getHours]() + (date0[getMinutes]() / m) + (date0[getSeconds]() / h);
			let incrHours = foundIncr / h;

			let minSpace = self.axes[axisIdx].space();		// TOFIX: only works for static space:
			let pctSpace = foundSpace / minSpace;

			while (1) {
				split = roundDec(split + foundIncr, 3);

				if (split > scaleMax)
					break;

				if (incrHours > 1) {
					let expectedHour = floor(roundDec(prevHour + incrHours, 6)) % 24;
					let splitDate = tzDate(split);
					let actualHour = splitDate.getHours();

					let dstShift = actualHour - expectedHour;

					if (dstShift > 1)
						dstShift = -1;

					split -= dstShift * h;

					prevHour = (prevHour + incrHours) % 24;

					// add a tick only if it's further than 70% of the min allowed label spacing
					let prevSplit = splits[splits.length - 1];
					let pctIncr = roundDec((split - prevSplit) / foundIncr, 3);

					if (pctIncr * pctSpace >= .7)
						splits.push(split);
				}
				else
					splits.push(split);
			}
		}

		return splits;
	}
}

export function timeSeriesStamp(stampCfg, fmtDate) {
	return fmtDate(stampCfg);
};

export const _timeSeriesStamp = '{YYYY}-{MM}-{DD} {h}:{mm}{aa}';

export function timeSeriesVal(tzDate, stamp) {
	return (self, val) => stamp(tzDate(val));
}

function cursorPoint(self, si) {
	let s = self.series[si];

	let pt = placeDiv();

	pt.style.background = s.stroke || hexBlack;

	let dia = ptDia(s.width, 1);
	let mar = (dia - 1) / -2;

	setStylePx(pt, WIDTH, dia);
	setStylePx(pt, HEIGHT, dia);
	setStylePx(pt, "marginLeft", mar);
	setStylePx(pt, "marginTop", mar);

	return pt;
}

function dataIdx(self, seriesIdx, cursorIdx) {
	return cursorIdx;
}

const moveTuple = [0,0];

function cursorMove(self, mouseLeft1, mouseTop1) {
	moveTuple[0] = mouseLeft1;
	moveTuple[1] = mouseTop1;
	return moveTuple;
}

function filtBtn0(self, targ, handle) {
	return e => {
		e.button == 0 && handle(e);
	};
}

function passThru(self, targ, handle) {
	return handle;
}

export const cursorOpts = {
	show: true,
	x: true,
	y: true,
	lock: false,
	move: cursorMove,
	points: {
		show: cursorPoint,
	},

	bind: {
		mousedown:   filtBtn0,
		mouseup:     filtBtn0,
		click:       filtBtn0,
		dblclick:    filtBtn0,

		mousemove:   passThru,
		mouseleave:  passThru,
		mouseenter:  passThru,
	},

	drag: {
		setScale: true,
		x: true,
		y: false,
		dist: 0,
		uni: null,
		_x: false,
		_y: false,
	},

	focus: {
		prox: -1,
	},

	locked: false,
	left: -10,
	top: -10,
	idx: null,
	dataIdx,
};

const grid = {
	show: true,
	stroke: "rgba(0,0,0,0.07)",
	width: 2,
//	dash: [],
	filter: retArg1,
};

const ticks = assign({}, grid, {size: 10});

const font      = '12px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
const labelFont = "bold " + font;
export const lineMult = 1.5;		// font-size multiplier

export const xAxisOpts = {
	show: true,
	scale: "x",
	space: 50,
	gap: 5,
	size: 50,
	labelSize: 30,
	labelFont,
	side: 2,
//	class: "x-vals",
//	incrs: timeIncrs,
//	values: timeVals,
//	filter: retArg1,
	grid,
	ticks,
	font,
	rotate: 0,
};

export const numSeriesLabel = "Value";
export const timeSeriesLabel = "Time";

export const xSeriesOpts = {
	show: true,
	scale: "x",
	auto: false,
	sorted: 1,
//	label: "Time",
//	value: v => stamp(new Date(v * 1e3)),

	// internal caches
	min: inf,
	max: -inf,
	idxs: [],
};

export function numAxisVals(self, splits, axisIdx, foundSpace, foundIncr) {
	return splits.map(v => v == null ? "" : fmtNum(v));
}

export function numAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
	let splits = [];

	let numDec = fixedDec.get(foundIncr);

	scaleMin = forceMin ? scaleMin : roundDec(incrRoundUp(scaleMin, foundIncr), numDec);

	for (let val = scaleMin; val <= scaleMax; val = roundDec(val + foundIncr, numDec))
		splits.push(val);

	return splits;
}

export function logAxisSplits(self, axisIdx, scaleMin, scaleMax, foundIncr, foundSpace, forceMin) {
	const splits = [];

	const logBase = self.scales[self.axes[axisIdx].scale].log;

	const logFn = logBase == 10 ? log10 : log2;

	const exp = floor(logFn(scaleMin));

	foundIncr = pow(logBase, exp);

	if (exp < 0)
		foundIncr = roundDec(foundIncr, -exp);

	let split = scaleMin;

	do {
		splits.push(split);
		split = roundDec(split + foundIncr, fixedDec.get(foundIncr));

		if (split >= foundIncr * logBase)
			foundIncr = split;

	} while (split <= scaleMax);

	return splits;
}

const RE_ALL   = /./;
const RE_12357 = /[12357]/;
const RE_125   = /[125]/;
const RE_1     = /1/;

export function logAxisValsFilt(self, splits, axisIdx, foundSpace, foundIncr) {
	let axis = self.axes[axisIdx];
	let scaleKey = axis.scale;

	if (self.scales[scaleKey].log == 2)
		return splits;

	let valToPos = self.valToPos;

	let minSpace = axis.space();			// TOFIX: only works for static space:

	let _10 = valToPos(10, scaleKey);

	let re = (
		valToPos(9, scaleKey) - _10 >= minSpace ? RE_ALL :
		valToPos(7, scaleKey) - _10 >= minSpace ? RE_12357 :
		valToPos(5, scaleKey) - _10 >= minSpace ? RE_125 :
		RE_1
	);

	return splits.map(v => re.test(v) ? v : null);
}

export function numSeriesVal(self, val) {
	return val == null ? "" : fmtNum(val);
}

export const yAxisOpts = {
	show: true,
	scale: "y",
	space: 30,
	gap: 5,
	size: 50,
	labelSize: 30,
	labelFont,
	side: 3,
//	class: "y-vals",
//	incrs: numIncrs,
//	values: (vals, space) => vals,
//	filter: retArg1,
	grid,
	ticks,
	font,
	rotate: 0,
};

// takes stroke width
export function ptDia(width, mult) {
	let dia = 3 + (width || 1) * 2;
	return roundDec(dia * mult, 3);
}

function seriesPoints(self, si) {
	const s = self.series[si];
	const dia = ptDia(s.width, pxRatio);
	let maxPts = self.bbox.width / (s.points.space * pxRatio);
	let idxs = self.series[0].idxs;
	return idxs[1] - idxs[0] <= maxPts;
}

export function seriesFillTo(self, seriesIdx, dataMin, dataMax) {
	let scale = self.scales[self.series[seriesIdx].scale];
	return scale.distr == 3 ? scale.min : 0;
}

export const ySeriesOpts = {
	scale: "y",
	auto: true,
	sorted: 0,
	show: true,
	band: false,
	spanGaps: false,
	alpha: 1,
	points: {
		show: seriesPoints,
	//	stroke: "#000",
	//	fill: "#fff",
	//	width: 1,
	//	size: 10,
	},
//	label: "Value",
//	value: v => v,
	values: null,

	// internal caches
	min: inf,
	max: -inf,
	idxs: [],

	path: null,
	clip: null,
};

export const xScaleOpts = {
	time: FEAT_TIME,
	auto: true,
	distr: 1,
	log: 10,
	min: null,
	max: null,
};

export const yScaleOpts = assign({}, xScaleOpts, {
	time: false,
});