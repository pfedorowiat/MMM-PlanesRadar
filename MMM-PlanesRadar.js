/* MagicMirror² Module: MMM-PlanesRadar
 *
 * Displays nearby aircraft on an old-style military radar scope
 * (green phosphor circle with a rotating sweep).
 *
 * Data source: adsb.lol (free, no API key) — see node_helper.js
 */

Module.register("MMM-PlanesRadar", {
	defaults: {
		lat: 52.2297,          // radar center latitude
		lon: 21.0122,          // radar center longitude
		range: 100,            // radar range in km
		updateInterval: 15,    // seconds between data fetches
		size: 400,             // scope diameter in px
		rotationTime: 4,       // seconds per full sweep rotation
		rings: 4,              // number of range rings
		showLabels: true,      // callsign + flight level next to blips
		showInfo: true,        // status line under the scope
		showDetails: true,     // table with nearest contacts under the scope
		detailsCount: 3,       // how many nearest contacts to list
		showGround: false,     // include aircraft on the ground
		maxPlanes: 40,         // cap on displayed aircraft
		color: "0, 255, 65",   // phosphor color as "r, g, b"
		apiBase: "https://api.adsb.lol/v2/point"
	},

	start() {
		this.planes = new Map();   // hex -> plane state (position, intensity, ...)
		this.sweepAngle = 0;       // bearing of the beam, radians, 0 = north
		this.lastFrame = null;
		this.animFrame = null;
		this.canvas = null;
		this.infoEl = null;
		this.detailsEl = null;
		this.contactCount = 0;
		this.lastDetailsUpdate = 0;

		this.sendSocketNotification("PLANESRADAR_CONFIG", {
			identifier: this.identifier,
			lat: this.config.lat,
			lon: this.config.lon,
			range: this.config.range,
			updateInterval: this.config.updateInterval,
			apiBase: this.config.apiBase
		});
	},

	getStyles() {
		return ["MMM-PlanesRadar.css"];
	},

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "planesradar";

		this.canvas = document.createElement("canvas");
		this.canvas.width = this.config.size;
		this.canvas.height = this.config.size;
		this.canvas.className = "planesradar-scope";
		wrapper.appendChild(this.canvas);

		if (this.config.showInfo) {
			this.infoEl = document.createElement("div");
			this.infoEl.className = "planesradar-info";
			this.infoEl.textContent = this.infoText();
			wrapper.appendChild(this.infoEl);
		}

		if (this.config.showDetails) {
			this.detailsEl = document.createElement("div");
			this.detailsEl.className = "planesradar-details";
			wrapper.appendChild(this.detailsEl);
		}

		this.startAnimation();
		return wrapper;
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "PLANESRADAR_DATA" || payload.identifier !== this.identifier) {
			return;
		}
		const now = Date.now();
		const seen = new Set();

		for (const ac of payload.planes) {
			if (!this.config.showGround && ac.onGround) continue;
			seen.add(ac.hex);
			const existing = this.planes.get(ac.hex);
			this.planes.set(ac.hex, {
				...ac,
				fetchedAt: now,
				intensity: existing ? existing.intensity : 0
			});
		}

		// Drop contacts not reported for a while
		const maxAge = this.config.updateInterval * 3000;
		for (const [hex, p] of this.planes) {
			if (!seen.has(hex) && now - p.fetchedAt > maxAge) {
				this.planes.delete(hex);
			}
		}

		this.contactCount = seen.size;
		if (this.infoEl) {
			this.infoEl.textContent = this.infoText();
		}
	},

	suspend() {
		this.stopAnimation();
		this.sendSocketNotification("PLANESRADAR_SUSPEND", { identifier: this.identifier });
	},

	resume() {
		this.startAnimation();
		this.sendSocketNotification("PLANESRADAR_RESUME", { identifier: this.identifier });
	},

	infoText() {
		const { lat, lon, range } = this.config;
		const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
		const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
		return `CONTACTS: ${this.contactCount}   RNG: ${range} KM   POS: ${latStr} ${lonStr}`;
	},

	startAnimation() {
		if (this.animFrame !== null) return;
		this.lastFrame = null;
		const loop = (t) => {
			this.animFrame = requestAnimationFrame(loop);
			this.drawFrame(t);
		};
		this.animFrame = requestAnimationFrame(loop);
	},

	stopAnimation() {
		if (this.animFrame !== null) {
			cancelAnimationFrame(this.animFrame);
			this.animFrame = null;
		}
	},

	/* Dead-reckon a plane's position forward from its last report
	 * using ground speed (knots) and track (degrees). */
	estimatePosition(p, now) {
		let lat = p.lat;
		let lon = p.lon;
		if (p.gs && p.track !== null && p.track !== undefined) {
			const dtH = (now - p.fetchedAt) / 3600000;      // hours
			const distKm = p.gs * 1.852 * dtH;
			const rad = (p.track * Math.PI) / 180;
			lat += (distKm * Math.cos(rad)) / 111.32;
			lon += (distKm * Math.sin(rad)) / (111.32 * Math.cos((lat * Math.PI) / 180));
		}
		return { lat, lon };
	},

	drawFrame(timestamp) {
		const canvas = this.canvas;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		const size = this.config.size;
		const cx = size / 2;
		const cy = size / 2;
		const R = size / 2 - 4;
		const col = this.config.color;
		const now = Date.now();

		// --- advance sweep ---
		let dt = 0;
		if (this.lastFrame !== null) {
			dt = Math.min((timestamp - this.lastFrame) / 1000, 0.2);
		}
		this.lastFrame = timestamp;
		const step = (2 * Math.PI * dt) / this.config.rotationTime;
		this.sweepAngle = (this.sweepAngle + step) % (2 * Math.PI);

		ctx.clearRect(0, 0, size, size);

		// --- scope background ---
		const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
		bg.addColorStop(0, `rgba(${col}, 0.10)`);
		bg.addColorStop(1, "rgba(0, 12, 2, 0.95)");
		ctx.fillStyle = bg;
		ctx.beginPath();
		ctx.arc(cx, cy, R, 0, 2 * Math.PI);
		ctx.fill();

		// --- range rings ---
		ctx.strokeStyle = `rgba(${col}, 0.35)`;
		ctx.lineWidth = 1;
		for (let i = 1; i <= this.config.rings; i++) {
			ctx.beginPath();
			ctx.arc(cx, cy, (R * i) / this.config.rings, 0, 2 * Math.PI);
			ctx.stroke();
		}

		// ring distance labels
		ctx.fillStyle = `rgba(${col}, 0.5)`;
		ctx.font = `${Math.max(9, size / 45)}px monospace`;
		ctx.textAlign = "left";
		for (let i = 1; i <= this.config.rings; i++) {
			const km = Math.round((this.config.range * i) / this.config.rings);
			ctx.fillText(`${km}`, cx + 3, cy - (R * i) / this.config.rings + 12);
		}

		// --- crosshairs + bearing ticks ---
		ctx.strokeStyle = `rgba(${col}, 0.25)`;
		ctx.beginPath();
		ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
		ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
		ctx.stroke();

		ctx.strokeStyle = `rgba(${col}, 0.5)`;
		for (let deg = 0; deg < 360; deg += 30) {
			const a = (deg * Math.PI) / 180;
			const sx = cx + (R - 6) * Math.sin(a);
			const sy = cy - (R - 6) * Math.cos(a);
			const ex = cx + R * Math.sin(a);
			const ey = cy - R * Math.cos(a);
			ctx.beginPath();
			ctx.moveTo(sx, sy);
			ctx.lineTo(ex, ey);
			ctx.stroke();
		}

		// --- sweep trail ---
		ctx.save();
		ctx.beginPath();
		ctx.arc(cx, cy, R, 0, 2 * Math.PI);
		ctx.clip();
		if (typeof ctx.createConicGradient === "function") {
			// Trail fades out behind the beam, all the way around
			const grad = ctx.createConicGradient(this.sweepAngle - Math.PI / 2, cx, cy);
			grad.addColorStop(0, `rgba(${col}, 0)`);
			grad.addColorStop(0.75, `rgba(${col}, 0)`);
			grad.addColorStop(1, `rgba(${col}, 0.35)`);
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, size, size);
		} else {
			// Fallback: 40 thin wedges with decreasing alpha behind the beam
			const segments = 40;
			const trail = Math.PI / 2;
			for (let i = 0; i < segments; i++) {
				const a0 = this.sweepAngle - (trail * (i + 1)) / segments;
				const a1 = this.sweepAngle - (trail * i) / segments;
				ctx.fillStyle = `rgba(${col}, ${0.3 * (1 - i / segments)})`;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.arc(cx, cy, R, a0 - Math.PI / 2, a1 - Math.PI / 2);
				ctx.closePath();
				ctx.fill();
			}
		}
		ctx.restore();

		// --- beam line ---
		ctx.strokeStyle = `rgba(${col}, 0.9)`;
		ctx.lineWidth = 2;
		ctx.shadowColor = `rgb(${col})`;
		ctx.shadowBlur = 8;
		ctx.beginPath();
		ctx.moveTo(cx, cy);
		ctx.lineTo(cx + R * Math.sin(this.sweepAngle), cy - R * Math.cos(this.sweepAngle));
		ctx.stroke();
		ctx.shadowBlur = 0;

		// --- aircraft blips ---
		const kmPerDegLat = 111.32;
		const cosLat = Math.cos((this.config.lat * Math.PI) / 180);
		const halfLife = this.config.rotationTime / 3;
		const decay = dt > 0 ? Math.pow(0.5, dt / halfLife) : 1;
		let drawn = 0;
		const visible = [];

		const sorted = [...this.planes.values()].sort(
			(a, b) => (a.distKm ?? Infinity) - (b.distKm ?? Infinity)
		);
		for (const p of sorted) {
			if (drawn >= this.config.maxPlanes) break;

			const pos = this.estimatePosition(p, now);
			const dxKm = (pos.lon - this.config.lon) * kmPerDegLat * cosLat;
			const dyKm = (pos.lat - this.config.lat) * kmPerDegLat;
			const dist = Math.hypot(dxKm, dyKm);
			p.distKm = dist;
			if (dist > this.config.range) continue;
			drawn++;

			const px = cx + (dxKm / this.config.range) * R;
			const py = cy - (dyKm / this.config.range) * R;

			visible.push({
				name: p.callsign || p.hex.toUpperCase(),
				type: p.type,
				dist,
				bearingDeg: ((Math.atan2(dxKm, dyKm) * 180) / Math.PI + 360) % 360,
				alt: p.alt,
				gs: p.gs
			});

			// Light the blip up when the beam passes over it
			const bearing = Math.atan2(dxKm, dyKm);
			const delta = (this.sweepAngle - bearing + 2 * Math.PI) % (2 * Math.PI);
			if (delta <= step) {
				p.intensity = 1;
			} else {
				p.intensity *= decay;
			}

			const alpha = 0.25 + 0.75 * p.intensity;

			// velocity vector
			if (p.gs && p.track !== null && p.track !== undefined) {
				const tRad = (p.track * Math.PI) / 180;
				const vLen = Math.min(16, 4 + p.gs / 40);
				ctx.strokeStyle = `rgba(${col}, ${alpha * 0.8})`;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(px, py);
				ctx.lineTo(px + vLen * Math.sin(tRad), py - vLen * Math.cos(tRad));
				ctx.stroke();
			}

			// blip
			ctx.fillStyle = `rgba(${col}, ${alpha})`;
			ctx.shadowColor = `rgb(${col})`;
			ctx.shadowBlur = 6 * p.intensity;
			ctx.beginPath();
			ctx.arc(px, py, 3, 0, 2 * Math.PI);
			ctx.fill();
			ctx.shadowBlur = 0;

			// label
			if (this.config.showLabels) {
				const name = p.callsign || p.hex.toUpperCase();
				let label = name;
				if (typeof p.alt === "number") {
					label += ` FL${String(Math.round(p.alt / 100)).padStart(3, "0")}`;
				}
				ctx.fillStyle = `rgba(${col}, ${Math.max(0.35, alpha) * 0.9})`;
				ctx.font = `${Math.max(9, size / 42)}px monospace`;
				ctx.textAlign = px > cx ? "right" : "left";
				ctx.fillText(label, px + (px > cx ? -6 : 6), py - 6);
			}
		}

		// --- outer bezel ---
		ctx.strokeStyle = `rgba(${col}, 0.8)`;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(cx, cy, R, 0, 2 * Math.PI);
		ctx.stroke();

		if (this.detailsEl && now - this.lastDetailsUpdate > 1000) {
			this.lastDetailsUpdate = now;
			this.updateDetails(visible);
		}
	},

	/* Text block with the nearest contacts, fixed-width columns:
	 * callsign, type, distance, bearing, flight level, ground speed. */
	updateDetails(visible) {
		const nearest = visible
			.sort((a, b) => a.dist - b.dist)
			.slice(0, this.config.detailsCount);

		const lines = nearest.map((p) => {
			const name = p.name.padEnd(8);
			const type = (p.type || "----").padEnd(4);
			const dst = `${String(Math.round(p.dist)).padStart(3)}KM`;
			const brg = `${String(Math.round(p.bearingDeg) % 360).padStart(3, "0")}°`;
			const alt =
				typeof p.alt === "number"
					? `FL${String(Math.round(p.alt / 100)).padStart(3, "0")}`
					: "FL---";
			const spd = p.gs !== null ? `${String(Math.round(p.gs)).padStart(3)}KT` : "---KT";
			return `${name} ${type} ${dst} ${brg} ${alt} ${spd}`;
		});

		const header = "CALLSIGN TYPE DST   BRG  ALT   SPD";
		const body = lines.length > 0 ? lines.join("\n") : "NO CONTACTS";

		// Rebuild only when content changed to avoid DOM churn
		const text = `${header}\n${body}`;
		if (text === this.lastDetailsText) return;
		this.lastDetailsText = text;

		this.detailsEl.textContent = "";
		const headerEl = document.createElement("div");
		headerEl.className = "planesradar-details-header";
		headerEl.textContent = header;
		this.detailsEl.appendChild(headerEl);
		const bodyEl = document.createElement("div");
		bodyEl.className = "planesradar-details-body";
		bodyEl.textContent = body;
		this.detailsEl.appendChild(bodyEl);
	}
});
