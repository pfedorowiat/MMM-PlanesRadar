/* MMM-PlanesRadar node_helper
 *
 * Periodically fetches aircraft near the configured location from the
 * adsb.lol v2 API (free, no API key) and pushes them to the front-end.
 * API docs: https://api.adsb.lol/docs
 */

const NodeHelper = require("node_helper");
const Log = require("logger");

module.exports = NodeHelper.create({
	start() {
		this.instances = new Map(); // identifier -> { config, timer }
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "PLANESRADAR_CONFIG") {
			this.stopInstance(payload.identifier);
			this.instances.set(payload.identifier, { config: payload, timer: null });
			this.schedule(payload.identifier);
		} else if (notification === "PLANESRADAR_SUSPEND") {
			this.stopInstance(payload.identifier);
		} else if (notification === "PLANESRADAR_RESUME") {
			if (this.instances.has(payload.identifier)) {
				this.schedule(payload.identifier);
			}
		}
	},

	stopInstance(identifier) {
		const inst = this.instances.get(identifier);
		if (inst && inst.timer) {
			clearInterval(inst.timer);
			inst.timer = null;
		}
	},

	schedule(identifier) {
		const inst = this.instances.get(identifier);
		if (!inst || inst.timer) return;
		this.fetchPlanes(identifier);
		inst.timer = setInterval(
			() => this.fetchPlanes(identifier),
			Math.max(5, inst.config.updateInterval) * 1000
		);
	},

	async fetchPlanes(identifier) {
		const inst = this.instances.get(identifier);
		if (!inst) return;
		const { lat, lon, range, apiBase } = inst.config;

		// API takes the radius in nautical miles, capped at 250
		const radiusNm = Math.min(250, Math.ceil(range / 1.852));
		const url = `${apiBase}/${lat}/${lon}/${radiusNm}`;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 10000);
		try {
			const res = await fetch(url, {
				signal: controller.signal,
				headers: { Accept: "application/json" }
			});
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const data = await res.json();
			const planes = (data.ac || [])
				.filter((ac) => typeof ac.lat === "number" && typeof ac.lon === "number")
				.map((ac) => ({
					hex: ac.hex,
					callsign: (ac.flight || "").trim() || null,
					lat: ac.lat,
					lon: ac.lon,
					alt: typeof ac.alt_baro === "number" ? ac.alt_baro : null,
					onGround: ac.alt_baro === "ground",
					gs: typeof ac.gs === "number" ? ac.gs : null,
					track: typeof ac.track === "number" ? ac.track : null,
					type: ac.t || null
				}));

			this.sendSocketNotification("PLANESRADAR_DATA", { identifier, planes });
		} catch (err) {
			Log.error(`MMM-PlanesRadar: fetch failed (${url}): ${err.message}`);
		} finally {
			clearTimeout(timeout);
		}
	}
});
