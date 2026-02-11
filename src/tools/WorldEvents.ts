export interface WorldEvent {
    id: string;
    lat: number;
    lon: number;
    country?: string;
    location?: string;
    eventCode?: string;
    eventRootCode?: string;
    tone?: number;
    goldstein?: number;
    source?: string;
    time?: string;
}

export type WorldEventSource = 'gdelt' | 'usgs' | 'opensky';

export interface WorldEventStats {
    total: number;
    avgTone: number;
    avgGoldstein: number;
    topSources: Array<{ key: string; count: number }>;
    topCountries: Array<{ key: string; count: number }>;
    topRootCodes: Array<{ key: string; count: number }>;
}

const ROOT_CODE_LABELS: Record<string, string> = {
    '01': 'Verbal cooperation',
    '02': 'Material cooperation',
    '03': 'Verbal conflict',
    '04': 'Material conflict'
};

export function getRootCodeLabel(code?: string): string {
    if (!code) return 'Event';
    return ROOT_CODE_LABELS[code] || 'Event';
}

function formatGdeltDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function parseNumber(val: any): number | undefined {
    if (val == null) return undefined;
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
}

export async function fetchGdeltEvents(opts: { minutes?: number; maxRecords?: number; query?: string } = {}): Promise<WorldEvent[]> {
    const minutes = Math.max(5, Math.min(180, opts.minutes ?? 60));
    const maxRecords = Math.max(50, Math.min(500, opts.maxRecords ?? 250));
    const query = (opts.query || 'global').trim();

    const end = new Date();
    const start = new Date(end.getTime() - minutes * 60 * 1000);

    const params = new URLSearchParams({
        format: 'json',
        maxrecords: String(maxRecords),
        query,
        startdatetime: formatGdeltDate(start),
        enddatetime: formatGdeltDate(end)
    });

    const url = `https://api.gdeltproject.org/api/v2/events/search?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`GDELT fetch failed: HTTP ${res.status}`);
    }

    const data: any = await res.json().catch(() => ({}));
    const events = data?.events || [];

    return events.map((e: any) => {
        const lat = parseNumber(e.ActionGeo_Lat ?? e.Actor1Geo_Lat ?? e.Actor2Geo_Lat);
        const lon = parseNumber(e.ActionGeo_Long ?? e.Actor1Geo_Long ?? e.Actor2Geo_Long);
        return {
            id: String(e.GLOBALEVENTID || e.SOURCEURL || `${e.DATEADDED || ''}-${Math.random()}`),
            lat: lat ?? 0,
            lon: lon ?? 0,
            country: e.ActionGeo_CountryCode || e.Actor1Geo_CountryCode || e.Actor2Geo_CountryCode,
            location: e.ActionGeo_FullName,
            eventCode: e.EventCode,
            eventRootCode: e.EventRootCode,
            tone: parseNumber(e.AvgTone),
            goldstein: parseNumber(e.GoldsteinScale),
            source: 'gdelt',
            time: e.DATEADDED
        } as WorldEvent;
    }).filter((e: WorldEvent) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
}

export async function fetchUsgsEarthquakes(opts: { minutes?: number } = {}): Promise<WorldEvent[]> {
    const minutes = Math.max(5, Math.min(1440, opts.minutes ?? 60));
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`USGS fetch failed: HTTP ${res.status}`);

    const data: any = await res.json().catch(() => ({}));
    const features = data?.features || [];
    const cutoff = Date.now() - minutes * 60 * 1000;

    return features
        .filter((f: any) => typeof f?.properties?.time === 'number' && f.properties.time >= cutoff)
        .map((f: any) => {
            const coords = f?.geometry?.coordinates || [];
            const lon = parseNumber(coords[0]);
            const lat = parseNumber(coords[1]);
            return {
                id: String(f.id || f.properties?.url || `${f.properties?.time}-${Math.random()}`),
                lat: lat ?? 0,
                lon: lon ?? 0,
                country: undefined,
                location: f.properties?.place,
                eventCode: f.properties?.mag != null ? `M${f.properties.mag}` : undefined,
                eventRootCode: 'EQ',
                tone: undefined,
                goldstein: undefined,
                source: 'usgs',
                time: new Date(f.properties?.time).toISOString()
            } as WorldEvent;
        })
        .filter((e: WorldEvent) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
}

export async function fetchOpenSkyFlights(): Promise<WorldEvent[]> {
    const url = 'https://opensky-network.org/api/states/all';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenSky fetch failed: HTTP ${res.status}`);

    const data: any = await res.json().catch(() => ({}));
    const states = data?.states || [];

    return states
        .map((s: any[]) => {
            const icao24 = s[0];
            const callsign = (s[1] || '').trim();
            const country = s[2];
            const lon = parseNumber(s[5]);
            const lat = parseNumber(s[6]);
            return {
                id: String(icao24 || callsign || Math.random()),
                lat: lat ?? 0,
                lon: lon ?? 0,
                country: country || undefined,
                location: callsign || undefined,
                eventCode: undefined,
                eventRootCode: 'FLIGHT',
                tone: undefined,
                goldstein: undefined,
                source: 'opensky',
                time: data?.time ? new Date(data.time * 1000).toISOString() : undefined
            } as WorldEvent;
        })
        .filter((e: WorldEvent) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
}

export async function fetchWorldEvents(
    sources: WorldEventSource[],
    opts: { minutes?: number; maxRecords?: number; gdeltQuery?: string }
): Promise<WorldEvent[]> {
    const unique = Array.from(new Set(sources));
    const results = await Promise.allSettled(unique.map((source) => {
        if (source === 'gdelt') return fetchGdeltEvents({ minutes: opts.minutes, maxRecords: opts.maxRecords, query: opts.gdeltQuery });
        if (source === 'usgs') return fetchUsgsEarthquakes({ minutes: opts.minutes });
        if (source === 'opensky') return fetchOpenSkyFlights();
        return Promise.resolve([]);
    }));

    const merged: WorldEvent[] = [];
    for (const r of results) {
        if (r.status === 'fulfilled') merged.push(...r.value);
    }
    return merged;
}

function topN(map: Map<string, number>, n: number): Array<{ key: string; count: number }> {
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([key, count]) => ({ key, count }));
}

export function aggregateWorldEvents(events: WorldEvent[]): WorldEventStats {
    const byCountry = new Map<string, number>();
    const byRoot = new Map<string, number>();
    const bySource = new Map<string, number>();
    let toneSum = 0;
    let toneCount = 0;
    let goldSum = 0;
    let goldCount = 0;

    for (const e of events) {
        const c = e.country || 'UNK';
        byCountry.set(c, (byCountry.get(c) || 0) + 1);

        const root = e.eventRootCode || '00';
        byRoot.set(root, (byRoot.get(root) || 0) + 1);

        const src = e.source || 'unknown';
        bySource.set(src, (bySource.get(src) || 0) + 1);

        if (typeof e.tone === 'number') {
            toneSum += e.tone;
            toneCount++;
        }
        if (typeof e.goldstein === 'number') {
            goldSum += e.goldstein;
            goldCount++;
        }
    }

    return {
        total: events.length,
        avgTone: toneCount ? toneSum / toneCount : 0,
        avgGoldstein: goldCount ? goldSum / goldCount : 0,
        topSources: topN(bySource, 4),
        topCountries: topN(byCountry, 5),
        topRootCodes: topN(byRoot, 4)
    };
}

export function summarizeWorldEvents(
    events: WorldEvent[],
    windowStart: Date,
    windowEnd: Date
): string {
    const stats = aggregateWorldEvents(events);
    const topCountries = stats.topCountries.map(c => `${c.key}:${c.count}`).join(', ') || 'none';
    const topRoots = stats.topRootCodes
        .map(r => `${r.key}(${ROOT_CODE_LABELS[r.key] || 'Other'}):${r.count}`)
        .join(', ') || 'none';
    const topSources = stats.topSources.map(s => `${s.key}:${s.count}`).join(', ') || 'none';

    return [
        `World events summary (${windowStart.toISOString()} → ${windowEnd.toISOString()}):`,
        `Total events: ${stats.total}`,
        `Top sources: ${topSources}`,
        `Top countries: ${topCountries}`,
        `Top event roots: ${topRoots}`,
        `Avg tone: ${stats.avgTone.toFixed(2)}, Avg goldstein: ${stats.avgGoldstein.toFixed(2)}`
    ].join(' ');
}
