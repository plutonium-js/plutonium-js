//polymorph (note: this source code is copyright polymorph and distributed under an MIT license - https://github.com/notoriousb1t/polymorph - this source code has been modified to fix bugs and work with Plutonium - see comments for changes)
//This code is responsible for morphing SVG paths. The code interpolates and fills in points as needed creating a smooth transition between two or more shapes regardless of differences in point quantity.
export default function(animator) {

	var _ = undefined;
	var V = 'V', H = 'H', L = 'L', Z = 'Z', M = 'M', C = 'C', S = 'S', Q = 'Q', T = 'T', A = 'A';
	var EMPTY = ' ';
	var util = animator.util;
	
	function isString(obj) {
		return typeof obj === 'string';
	}

	function renderPath(data, formatter) {
		var ns = data.ns;
		if (isString(ns)) {
			return ns;
		}
		var result = [];
		for (var i = 0; i < ns.length; i++) {
			var n = ns[i];
			result.push(M, formatter(n[0]), formatter(n[1]), C);
			var lastResult = void 0;
			for (var f = 2; f < n.length; f += 6) {
				var p0 = formatter(n[f]);
				var p1 = formatter(n[f + 1]);
				var p2 = formatter(n[f + 2]);
				var p3 = formatter(n[f + 3]);
				var dx = formatter(n[f + 4]);
				var dy = formatter(n[f + 5]);
				var isPoint = p0 === dx && p2 === dx && p1 === dy && p3 === dy;
				if (!isPoint || lastResult !== (lastResult = ('' + p0 + p1 + p2 + p3 + dx + dy))) {
					result.push(p0, p1, p2, p3, dx, dy);
				}
			}
			//close the sub path if applicable
			if (data.z[i]) result.push(Z);
		}
		return result.join(EMPTY);
	}

	var math = Math;
	var abs = math.abs;
	var min = math.min;
	var max = math.max;
	var floor = math.floor;
	var sqrt = math.sqrt;
	var cos = math.cos;
	var asin = math.asin;
	var sin = math.sin;
	var tan = math.tan;
	var PI = math.PI;
	var quadraticRatio = 2.0 / 3;
	
	function fillObject(dest, src) {
		for (var key in src) {
			if (!dest.hasOwnProperty(key)) {
				dest[key] = src[key];
			}
		}
		return dest;
	}

	function createNumberArray(n) {
		return new (window.Float32Array?Float32Array:Array)(n);
	}

	//fill path segments/sub paths (note: this adds segments/sub paths so both paths have an equal number of segments/sub paths)
	function fillSegments(larger, smaller, origin) {
		var largeLen = larger.length;
		var smallLen = smaller.length;
		if (largeLen < smallLen) {
			return fillSegments(smaller, larger, origin);
		}
		smaller.length = largeLen;
		for (var i = smallLen; i < largeLen; i++) {
			var l = larger[i];
			var d = createNumberArray(l.d.length);
			for (var k=0;k<l.d.length;k+=2) {
				//center all points in the larger space (note: this has been modified by Plutonium to center the point vs. the default origin positioning)
				d[k] = l.x+(l.w/2);
				d[k+1] = l.y+(l.h/2);
			}
			smaller[i] = fillObject({d:d}, l);
		}
	}

	//rotate points (note: this has been modified by Plutonium)
	function rotatePoints(ns, count) {
		var len = ns.length;
		var rightLen = len - count;
		var buffer = createNumberArray(count);
		var i;
		for (i = 0; i < count; i++) {
			buffer[i] = ns[i];
		}
		for (i = count; i < len; i++) {
			ns[i - count] = ns[i];
		}
		for (i = 0; i < count; i++) {
			ns[rightLen + i] = buffer[i];
		}
	}
	
	//reverse points direction form clockwise to counter clockwise or vice versa (part of normalization)
	//NOTE: this is a Plutonium added feature
	function _reverse_points_direction(ns) {
		var reversed = [];
		//loop the buffer
		var px=ns[0],py=ns[1]; for (let i=2;i<ns.length;i=i+6) {
			//add the cubic bezier points to the beginning of the return array
			reversed.unshift(ns[i+2], ns[i+3], ns[i], ns[i+1], px, py);
			//save previous x and y
			px = ns[i+4]; py = ns[i+5];
		}
		//add the start 'M' point
		reversed.unshift(ns[0],ns[1]);
		//loop the reversed array and update the segements array
		for (let i=0;i<reversed.length;i++) ns[i] = reversed[i];
	}
	
	//normalize points (note: normalization roates and changes point flow direction)
	//NOTE: normalization has been modified by Plutonium
	function normalizePoints(ns) {
		//get the buffer array and length
		var buffer = ns.slice(2); var len = buffer.length;
		//init the area
		var area=0;
		//init min vars and loop the buffer
		var minIndex, minAmount; for (let i=0;i<len;i+=6) {
			//get x and y
			var x = buffer[i]; var y = buffer[i+1];
			//get the distance between the point and the origin
			var dist = util.getPointDist(0, 0, x, y);
			//set the index to the min distance if applicable
			if (minAmount === _ || dist < minAmount) {
				minAmount = dist;
				minIndex = i;
			}
			//get the next point index and points
			var nextI = (i+6)%len; var nextX = buffer[nextI]; var nextY = buffer[nextI+1];
			//add or substract from the area
			area += x * nextY;
			area -= nextX * y;
		}
		//rotate the points
		rotatePoints(buffer, minIndex);
		//set the segements to the buffer
		ns[0] = buffer[len - 2];
		ns[1] = buffer[len - 1];
		for (let i = 0; i < len; i++) {
			ns[i + 2] = buffer[i];
		}
		//get the clockwise status and change the point direction if not true
		var cw = area/2>0; if (!cw) _reverse_points_direction(ns);
	}
	
	function fillPoints(matrix, addPoints) {
		var ilen = matrix[0].length;
		for (var i = 0; i < ilen; i++) {
			var left = matrix[0][i];
			var right = matrix[1][i];
			var totalLength = max(left.length+addPoints, right.length+addPoints);
			matrix[0][i] = fillSubpath(left, totalLength);
			matrix[1][i] = fillSubpath(right, totalLength);
		}
	}
	
	function fillSubpath(ns, totalLength) {
		var totalNeeded = totalLength-ns.length;
		var ratio = Math.ceil(totalNeeded/ns.length);
		var result = createNumberArray(totalLength);
		result[0] = ns[0];
		result[1] = ns[1];
		var k = 1, j = 1;
		while (j < totalLength - 1) {
			result[++j] = ns[++k];
			result[++j] = ns[++k];
			result[++j] = ns[++k];
			result[++j] = ns[++k];
			var dx = result[++j] = ns[++k];
			var dy = result[++j] = ns[++k];
			if (totalNeeded) {
				//note: Plutonium changed f = ratio to f <= ratio (this edit fixed a bug where not all the fill sub path data was bieng added correctly for some morphs)
				for (var f = 0; f <= ratio && totalNeeded; f++) {
					result[j + 5] = result[j + 3] = result[j + 1] = dx;
					result[j + 6] = result[j + 4] = result[j + 2] = dy;
					j += 6;
					totalNeeded -= 6;
				}
			}
		}
		return result;
	}

	function sizeDesc(a, b) {
		return b.p - a.p;
	}
	
	//normalize paths
	function normalizePaths(left, right, options) {
		var leftPath = getSortedSegments(left);
		var rightPath = getSortedSegments(right);
		if (leftPath.length !== rightPath.length) {
			fillSegments(leftPath, rightPath, options.origin);
		}
		var matrix = Array(2);
		matrix[0] = leftPath.map(toPoints);
		matrix[1] = rightPath.map(toPoints);
		for (var i = 0; i < leftPath.length; i++) {
			if (leftPath[i].z||rightPath[i].z) {
				normalizePoints(matrix[0][i]);
				normalizePoints(matrix[1][i]);
			}
		}
		fillPoints(matrix, options.addPoints*6);
		return matrix;
	}
	
	function getSortedSegments(path) {
		return path.data.slice().sort(sizeDesc);
	}
	
	function toPoints(p) {
		return p.d;
	}

	var defaultOptions = {
		addPoints: 0,
		origin: { x: 0, y: 0 }
	};
	
	function interpolatePath(paths, options) {
		options = fillObject(options, defaultOptions);
		var hlen = paths.length - 1;
		var items = Array(hlen);
		for (var h = 0; h < hlen; h++) {
			//set the item to the path interpolator function
			items[h] = getPathInterpolator(paths[h], paths[h + 1], options);
		}
		return function (tweenData) {
			return renderPath(items[0](tweenData), formatter);
		};
	}
	
	//format numbers to 6 decimal places
	//note: this was added by Plutonium
	function formatter(n) {return util.round(n,6);}
	
	//node: this method was modifed by Plutonium to account for closing sub paths
	function getPathInterpolator(left, right, options, z) {
		var matrix = normalizePaths(left, right, options);
		var n = matrix[0].length;
		return function (tweenData) {
			var zData = Array(n);
			var ns = Array(n); for (var h = 0; h < n; h++) {
				ns[h] = mixPoints(matrix[0][h], matrix[1][h], tweenData);
				var z = left.data[h]?left.data[h].z:null||right.data[h]?right.data[h].z:null;
				zData[h] = z;
			}
			return {ns:ns, z:zData}
		};
	}
	
	//note: a and b are segments
	function mixPoints(a, b, tweenData) {
		var alen = a.length;
		var results = createNumberArray(alen);
		for (var i = 0; i < alen; i++) {
			let tweenVal = animator.tween({
				startVal:a[i],
				endVal:b[i],
				timing:tweenData.timing,
				time:tweenData.time,
				duration:tweenData.duration
			});
			results[i] = tweenVal;
		}
		return results;
	}

	function coalesce(current, fallback) {
		return current === _ ? fallback : current;
	}

	var _120 = PI * 120 / 180;
	var PI2 = PI * 2;
	function arcToCurve(x1, y1, rx, ry, angle, large, sweep, dx, dy, f1, f2, cx, cy) {
		if (rx <= 0 || ry <= 0) {
			return [x1, y1, dx, dy, dx, dy];
		}
		var rad = PI / 180 * (+angle || 0);
		var cosrad = cos(rad);
		var sinrad = sin(rad);
		var recursive = !!f1;
		if (!recursive) {
			var x1old = x1;
			var dxold = dx;
			x1 = x1old * cosrad - y1 * -sinrad;
			y1 = x1old * -sinrad + y1 * cosrad;
			dx = dxold * cosrad - dy * -sinrad;
			dy = dxold * -sinrad + dy * cosrad;
			var x = (x1 - dx) / 2;
			var y = (y1 - dy) / 2;
			var h = x * x / (rx * rx) + y * y / (ry * ry);
			if (h > 1) {
				h = sqrt(h);
				rx = h * rx;
				ry = h * ry;
			}
			var k = (large === sweep ? -1 : 1) *
				sqrt(abs((rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)));
			cx = k * rx * y / ry + (x1 + dx) / 2;
			cy = k * -ry * x / rx + (y1 + dy) / 2;
			f1 = asin((y1 - cy) / ry);
			f2 = asin((dy - cy) / ry);
			if (x1 < cx) {
				f1 = PI - f1;
			}
			if (dx < cx) {
				f2 = PI - f2;
			}
			if (f1 < 0) {
				f1 += PI2;
			}
			if (f2 < 0) {
				f2 += PI2;
			}
			if (sweep && f1 > f2) {
				f1 -= PI2;
			}
			if (!sweep && f2 > f1) {
				f2 -= PI2;
			}
		}
		var res;
		if (abs(f2 - f1) > _120) {
			var f2old = f2;
			var x2old = dx;
			var y2old = dy;
			f2 = f1 + _120 * (sweep && f2 > f1 ? 1 : -1);
			dx = cx + rx * cos(f2);
			dy = cy + ry * sin(f2);
			res = arcToCurve(dx, dy, rx, ry, angle, 0, sweep, x2old, y2old, f2, f2old, cx, cy);
		}
		else {
			res = [];
		}
		var t = 4 / 3 * tan((f2 - f1) / 4);
		res.splice(0, 0, 2 * x1 - (x1 + t * rx * sin(f1)), 2 * y1 - (y1 - t * ry * cos(f1)), dx + t * rx * sin(f2), dy - t * ry * cos(f2), dx, dy);
		if (!recursive) {
			for (var i = 0, ilen = res.length; i < ilen; i += 2) {
				var xt = res[i], yt = res[i + 1];
				res[i] = xt * cosrad - yt * sinrad;
				res[i + 1] = xt * sinrad + yt * cosrad;
			}
		}
		return res;
	}

	var argLengths = { M: 2, H: 1, V: 1, L: 2, Z: 0, C: 6, S: 4, Q: 4, T: 2, A: 7 };
	function addCurve(ctx, x1, y1, x2, y2, dx, dy) {
		var x = ctx.x;
		var y = ctx.y;
		ctx.x = coalesce(dx, x);
		ctx.y = coalesce(dy, y);
		ctx.p.push(coalesce(x1, x), (y1 = coalesce(y1, y)), (x2 = coalesce(x2, x)), (y2 = coalesce(y2, y)), ctx.x, ctx.y);
		ctx.lc = ctx.c;
	}
	function convertToAbsolute(ctx) {
		var c = ctx.c;
		var t = ctx.t;
		var x = ctx.x;
		var y = ctx.y;
		if (c === V) {
			t[0] += y;
		}
		else if (c === H) {
			t[0] += x;
		}
		else if (c === A) {
			t[5] += x;
			t[6] += y;
		}
		else {
			for (var j = 0; j < t.length; j += 2) {
				t[j] += x;
				t[j + 1] += y;
			}
		}
	}
	
	//note: this function has been modified by Plutonium to fix a bug where move commands with additional line commands included in the move command were not bieng dealt with and causing issues
	//note: support for exponential number notation was also added by Plutonium
	function parseSegments(d) {
		//split the string by command
		d=d.replace(/[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)/g,function(val){return util.round(val,6);})
		.replace(/[\^\s]*([mhvlzcsqta]|-?\d*\.?\d+)[,$\s]*/gi, ' $1')
		.replace(/([mhvlzcsqta])/gi, ' $1')
		.trim()
		.split('  ')
		//loop the split string array
		for (var i=0;i<d.length;i++) {
			//split the terms
			var terms = d[i].split(EMPTY).map(parseCommand);
			//get the commnad
			var command = terms[0];
			//if the segment command is m continue
			if (/m/i.test(command)) {
				//get the lowercase command
				var commandLC = command.toLowerCase();
				//loop extra xy pairs in the move command, these are line commands
				var count=1; for (var j=3;j<terms.length;j=j+2) {
					//create the line segment
					var lineSeg = (commandLC===command?'l':'L')+' '+terms[j]+' '+terms[j+1];
					//add the line segment
					d.splice(i+count,0,lineSeg);
					//incrament the count
					count++;
				}
				//remove the line segments from the move command
				terms = terms.slice(0,3);
			}
			//set the terms
			d[i] = terms;
		}
		return d;
	}
	
	function parseCommand(str, i) {
		return i === 0 ? str : +str;
	}
	
	function parsePoints(d) {
		//init ctx
		var ctx = {
			x: 0,
			y: 0,
			s: [],
			z:[]
		};
		//parse the segments
		var segments = parseSegments(d);
		//loop the segments
		for (var i = 0; i < segments.length; i++) {
			var terms = segments[i];
			var commandLetter = terms[0];
			var command = commandLetter.toUpperCase();
			var isRelative = command !== Z && command !== commandLetter;
			ctx.c = command;
			var maxLength = argLengths[command];
			var t2 = terms;
			var k = 1;
			do {
				ctx.t = t2.length === 1 ? t2 : t2.slice(k, k + maxLength);
				if (isRelative) {
					convertToAbsolute(ctx);
				}
				var n = ctx.t;
				var x = ctx.x;
				var y = ctx.y;
				var x1 = void 0, y1 = void 0, dx = void 0, dy = void 0, x2 = void 0, y2 = void 0;
				if (command === M) {
					ctx.s.push((ctx.p = [(ctx.x = n[0]), (ctx.y = n[1])]));
					//add an initial false item z commands (note: this is a Plutonium added feature to deal with sub paths)
					ctx.z.push(0);
				}
				else if (command === H) {
					addCurve(ctx, _, _, _, _, n[0], _);
				}
				else if (command === V) {
					addCurve(ctx, _, _, _, _, _, n[0]);
				}
				else if (command === L) {
					addCurve(ctx, _, _, _, _, n[0], n[1]);
				}
				else if (command === Z) {
					addCurve(ctx, _, _, _, _, ctx.p[0], ctx.p[1]);
					//set the z command status true (note: this is a Plutonium added feature to deal with sub paths)
					ctx.z[ctx.z.length-1]=1;
				}
				else if (command === C) {
					addCurve(ctx, n[0], n[1], n[2], n[3], n[4], n[5]);
					ctx.cx = n[2];
					ctx.cy = n[3];
				}
				else if (command === S) {
					var isInitialCurve = ctx.lc !== S && ctx.lc !== C;
					x1 = isInitialCurve ? _ : x * 2 - ctx.cx;
					y1 = isInitialCurve ? _ : y * 2 - ctx.cy;
					addCurve(ctx, x1, y1, n[0], n[1], n[2], n[3]);
					ctx.cx = n[0];
					ctx.cy = n[1];
				}
				else if (command === Q) {
					var cx1 = n[0];
					var cy1 = n[1];
					dx = n[2];
					dy = n[3];
					addCurve(ctx, x + (cx1 - x) * quadraticRatio, y + (cy1 - y) * quadraticRatio, dx + (cx1 - dx) * quadraticRatio, dy + (cy1 - dy) * quadraticRatio, dx, dy);
					ctx.cx = cx1;
					ctx.cy = cy1;
				}
				else if (command === T) {
					dx = n[0];
					dy = n[1];
					if (ctx.lc === Q || ctx.lc === T) {
						x1 = x + (x * 2 - ctx.cx - x) * quadraticRatio;
						y1 = y + (y * 2 - ctx.cy - y) * quadraticRatio;
						x2 = dx + (x * 2 - ctx.cx - dx) * quadraticRatio;
						y2 = dy + (y * 2 - ctx.cy - dy) * quadraticRatio;
					}
					else {
						x1 = x2 = x;
						y1 = y2 = y;
					}
					addCurve(ctx, x1, y1, x2, y2, dx, dy);
					ctx.cx = x2;
					ctx.cy = y2;
				}
				else if (command === A) {
					var beziers = arcToCurve(x, y, n[0], n[1], n[2], n[3], n[4], n[5], n[6]);
					for (var j = 0; j < beziers.length; j += 6) {
						addCurve(ctx, beziers[j], beziers[j + 1], beziers[j + 2], beziers[j + 3], beziers[j + 4], beziers[j + 5]);
					}
				}
				k += maxLength;
			} while (k < t2.length);
		}
		return ctx;
	}

	function perimeterPoints(pts) {
		var n = pts.length;
		var x2 = pts[n - 2];
		var y2 = pts[n - 1];
		var p = 0;
		for (var i = 0; i < n; i += 6) {
			p += util.getPointDist(pts[i], pts[i + 1], x2, y2);
			x2 = pts[i];
			y2 = pts[i + 1];
		}
		return floor(p);
	}

	//parse path data (note: this method has been modified by Plutonium to deal with sub paths)
	this.parsePath = function(d) {
		try {
			//get the parsed points data
			var data = parsePoints(d);
			//get the segements and loop
			var segments = data.s; for (var i=0;i<segments.length;i++) {
				//get the points
				var points = segments[i];
				//get points data
				var xmin = points[0];
				var ymin = points[1];
				var ymax = ymin;
				var xmax = xmin;
				for (var j = 2; j < points.length; j += 6) {
					var x = points[j + 4];
					var y = points[j + 5];
					xmin = min(xmin, x);
					xmax = max(xmax, x);
					ymin = min(ymin, y);
					ymax = max(ymax, y);
				}
				//save the segment
				segments[i] = {
					d: points,
					x: xmin,
					y: ymin,
					w: xmax - xmin,
					h: ymax - ymin,
					p: perimeterPoints(points),
					z: data.z[i]
				};
			}
			//return the path data
			return {
				path:d.trim(),
				data:segments
			};
		}
		catch(e){
			//log the error
			util.errorLog.log({code:3, error:e, msg:'cannot parse path - '+e});
		}
	}

	//interpolate two or more paths (only two are ever used by Plutonium) (note: this returns a function that accepts a single offset argument from 0 to 1 that will generate the resulting shape, e.g. var interpolation=interpolate([paths], options); var resultPath=interpolation(.5); )
	this.interpolate = function(paths, options) {
		return interpolatePath(paths, options || {});
	}
}













