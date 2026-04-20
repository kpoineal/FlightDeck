const REPO = 'kpoineal/FlightDeck';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const FALLBACK = `https://github.com/${REPO}/releases/latest`;

/** @type {{ msi: string|null, dmg: string|null, fallback: string }} */
let cached = $state({ msi: null, dmg: null, fallback: FALLBACK });

let fetched = false;

export function getDownloadUrls() {
	if (!fetched) {
		fetched = true;
		fetch(API)
			.then(r => r.json())
			.then(data => {
				if (!data.assets) return;
				for (const a of data.assets) {
					if (a.name.endsWith('.msi')) cached.msi = a.browser_download_url;
					if (a.name.endsWith('.dmg')) cached.dmg = a.browser_download_url;
				}
			})
			.catch(() => {});
	}
	return cached;
}
