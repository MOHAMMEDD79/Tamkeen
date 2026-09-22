'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CircleMarker, Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, MapPin } from 'lucide-react';

/**
 * Maps on OpenStreetMap tiles, drawn with Leaflet in the browser only (it needs `window`).
 *
 * A project shows at the precision it chose: an exact pin, an approximate area, or its city. The
 * shaded circle is deliberately wide for the last two, so the map never suggests a precision the
 * project did not publish — the coordinates of a beneficiary's home are never on the public side.
 */

export interface MapPoint {
  latitude: number; longitude: number;
  precision: 'exact' | 'approximate' | 'city';
  title?: string; href?: string;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const RADIUS: Record<MapPoint['precision'], number> = { exact: 0, approximate: 1200, city: 4000 };
const BRAND = '#0A7A68';
const ACCENT = '#F5A524';

/** Loads Leaflet on the client and hands back a fresh map on the given element. */
async function createMap(element: HTMLElement, options: { center: [number, number]; zoom: number; interactive?: boolean }) {
  const L = await import('leaflet');
  const map = L.map(element, { center: options.center, zoom: options.zoom, scrollWheelZoom: options.interactive ?? false, attributionControl: true });
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  return { L, map };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

/** A read-only map of one or more projects. */
export function ProjectMap({ points, height = 360, label }: { points: MapPoint[]; height?: number; label: string }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current || !points.length) return;
    let map: LeafletMap | null = null;
    let cancelled = false;
    void createMap(element.current, { center: [points[0]!.latitude, points[0]!.longitude], zoom: points.length === 1 ? (points[0]!.precision === 'exact' ? 15 : points[0]!.precision === 'approximate' ? 13 : 11) : 8 }).then(({ L, map: created }) => {
      if (cancelled) { created.remove(); return; }
      map = created;
      const bounds = L.latLngBounds([]);
      for (const point of points) {
        const at = L.latLng(point.latitude, point.longitude);
        bounds.extend(at);
        const popup = point.title ? (point.href ? `<a href="${escapeHtml(point.href)}">${escapeHtml(point.title)}</a>` : escapeHtml(point.title)) : '';
        if (RADIUS[point.precision]) {
          const area = L.circle(at, { radius: RADIUS[point.precision], color: BRAND, weight: 2, fillColor: BRAND, fillOpacity: 0.18 }).addTo(created);
          if (popup) area.bindPopup(popup);
        }
        const dot = L.circleMarker(at, { radius: point.precision === 'exact' ? 10 : 7, color: '#FFFFFF', weight: 3, fillColor: point.precision === 'exact' ? ACCENT : BRAND, fillOpacity: 1 }).addTo(created);
        if (popup) dot.bindPopup(popup);
      }
      if (points.length > 1) created.fitBounds(bounds.pad(0.2), { maxZoom: 12 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [points]);
  if (!points.length) return null;
  return <div ref={element} className="tmk-map" style={{ blockSize: height }} role="region" aria-label={label} />;
}

/**
 * Click the map to place the project; click again to move it. The chosen point is submitted with the form
 * through two hidden inputs, so the picker works inside any existing form.
 */
export function LocationPicker({ latitude, longitude, center, nameLatitude = 'latitude', nameLongitude = 'longitude', disabled = false }: {
  latitude: number | null; longitude: number | null; center: { latitude: number; longitude: number } | null;
  nameLatitude?: string; nameLongitude?: string; disabled?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const marker = useRef<CircleMarker | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [point, setPoint] = useState<{ latitude: number; longitude: number } | null>(latitude !== null && longitude !== null ? { latitude, longitude } : null);

  useEffect(() => {
    if (!element.current) return;
    let cancelled = false;
    const start = point ?? center ?? { latitude: 31.9, longitude: 35.2 };
    void createMap(element.current, { center: [start.latitude, start.longitude], zoom: point ? 15 : center ? 12 : 8, interactive: true }).then(({ L, map }) => {
      if (cancelled) { map.remove(); return; }
      mapRef.current = map;
      const place = (at: { lat: number; lng: number }) => {
        const next = { latitude: Number(at.lat.toFixed(6)), longitude: Number(at.lng.toFixed(6)) };
        if (marker.current) marker.current.setLatLng([next.latitude, next.longitude]);
        else marker.current = L.circleMarker([next.latitude, next.longitude], { radius: 11, color: '#FFFFFF', weight: 3, fillColor: ACCENT, fillOpacity: 1 }).addTo(map);
        setPoint(next);
      };
      if (point) place({ lat: point.latitude, lng: point.longitude });
      if (!disabled) map.on('click', event => place(event.latlng));
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; marker.current = null; };
    // Built once: later clicks move the marker without rebuilding the map.
  }, []);

  const recenter = () => {
    if (!center || !mapRef.current) return;
    mapRef.current.setView([center.latitude, center.longitude], 12);
  };

  return (
    <div className="tmk-map-picker">
      <div ref={element} className="tmk-map tmk-map--picker" role="application" aria-label="اضغط على الخريطة لتحديد موقع المشروع" />
      <div className="tmk-map-picker__bar">
        <span><MapPin aria-hidden="true" size={16} />{point ? <bdi dir="ltr">{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</bdi> : 'لم يُحدَّد موقع بعد — اضغط على الخريطة'}</span>
        {center ? <button type="button" className="tmk-button tmk-button--quiet" onClick={recenter}><Crosshair aria-hidden="true" size={16} />مركز المدينة</button> : null}
      </div>
      <input type="hidden" name={nameLatitude} value={point ? String(point.latitude) : ''} />
      <input type="hidden" name={nameLongitude} value={point ? String(point.longitude) : ''} />
    </div>
  );
}

type Precision = MapPoint['precision'];
const PRECISION_LABELS: Record<Precision, string> = {
  city: 'المدينة فقط — لا تُخزَّن إحداثيات',
  approximate: 'تقريبي — يُنشر مقرّبًا إلى نحو كيلومتر',
  exact: 'منشأة عامة محددة — يُنشر كما هو'
};

/** Precision plus the picker, as one group of form fields. */
export function LocationFields({ precision, onPrecision, latitude, longitude, center }: {
  precision: Precision; onPrecision: (next: Precision) => void;
  latitude: number | null; longitude: number | null; center: { latitude: number; longitude: number } | null;
}) {
  return (
    <div className="tmk-location-fields">
      <label className="tmk-field" style={{ margin: 0 }}>
        <span className="tmk-field__label">دقة الموقع المعلن للزوار</span>
        <select className="tmk-field__control" name="publicLocationPrecision" value={precision} onChange={event => onPrecision(event.target.value as Precision)}>
          {(Object.keys(PRECISION_LABELS) as Precision[]).map(key => <option key={key} value={key}>{PRECISION_LABELS[key]}</option>)}
        </select>
      </label>
      {precision === 'city'
        ? <p className="tmk-field__hint" style={{ margin: 0 }}>لن تُخزَّن إحداثيات لهذا المشروع؛ يظهر على الخريطة في مركز مدينته. ما لا يُخزَّن لا يمكن أن يتسرب.</p>
        : <>
            <p className="tmk-field__hint" style={{ margin: 0 }}>اضغط على الخريطة لتحديد مكان التنفيذ. لا تحدّد موقع مستفيد أو عنوان سكن: الموقع المعلن يخص مكانًا عامًا فقط.</p>
            <LocationPicker key={`${center?.latitude ?? ''}-${center?.longitude ?? ''}`} latitude={latitude} longitude={longitude} center={center} />
          </>}
    </div>
  );
}

interface OrgProjectLocation {
  version: number; publicLocationPrecision: Precision; latitude: number | null; longitude: number | null;
  city: { latitude: number; longitude: number; nameAr: string };
}

/**
 * The organisation's "where is it" card on its project page. Anyone with `project.update` in the
 * organisation can move the pin in any state; the API enforces the permission and the precision rule.
 */
export function ProjectLocationEditor({ orgId, projectId }: { orgId: string; projectId: string }) {
  const [project, setProject] = useState<OrgProjectLocation | null>(null);
  const [precision, setPrecision] = useState<Precision>('city');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const load = async () => {
    const response = await fetch(`/api/v1/orgs/${orgId}/projects/${projectId}`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return;
    const body = await response.json() as { data: OrgProjectLocation };
    setProject(body.data); setPrecision(body.data.publicLocationPrecision);
  };
  useEffect(() => { void load(); }, [orgId, projectId]);
  if (!project) return null;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => { const raw = String(data.get(name) ?? ''); return raw ? Number(raw) : null; };
    const latitude = precision === 'city' ? null : number('latitude');
    const longitude = precision === 'city' ? null : number('longitude');
    if (precision !== 'city' && (latitude === null || longitude === null)) { setMessage({ tone: 'danger', text: 'اضغط على الخريطة لتحديد الموقع أولًا.' }); return; }
    setBusy(true); setMessage(null);
    fetch(`/api/v1/orgs/${orgId}/projects/${projectId}/location`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicLocationPrecision: precision, latitude, longitude, version: project.version })
    }).then(async response => {
      if (!response.ok) throw new Error(response.status === 409 ? 'تغيّر المشروع من مكان آخر. حدّث الصفحة ثم أعد المحاولة.' : response.status === 403 ? 'لا تملك صلاحية تعديل موقع هذا المشروع.' : 'تعذر حفظ الموقع.');
      await load();
      setMessage({ tone: 'success', text: 'حُفظ موقع المشروع وظهر على الخريطة.' });
    }).catch(error => setMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'تعذر حفظ الموقع.' }))
      .finally(() => setBusy(false));
  };

  return (
    <section className="tmk-card tmk-location-card" aria-labelledby="project-location-title">
      <h2 id="project-location-title" className="tmk-card__title">الموقع على الخريطة</h2>
      <form onSubmit={save} className="tmk-location-card__form">
        <LocationFields precision={precision} onPrecision={setPrecision} latitude={project.latitude} longitude={project.longitude} center={{ latitude: project.city.latitude, longitude: project.city.longitude }} />
        {message ? <p className={`tmk-location-card__message tmk-location-card__message--${message.tone}`} role="status">{message.text}</p> : null}
        <p style={{ margin: 0 }}><button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الموقع'}</button></p>
      </form>
    </section>
  );
}
