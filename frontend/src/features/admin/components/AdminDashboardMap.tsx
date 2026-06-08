import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { listStorageEndpoints } from '../../../api/storageEndpoints';
import { fetchHealthWorkspaceOverview } from '../../../api/healthchecks';

interface EndpointWithStatus {
  id: number;
  name: string;
  lat?: number | null;
  lng?: number | null;
  status: 'up' | 'degraded' | 'down' | 'unknown';
}

const statusColorMap: Record<string, string> = {
  up: '#10b981',       // green-500
  degraded: '#f59e0b', // amber-500
  down: '#ef4444',     // red-500
  unknown: '#9ca3af',   // gray-400,
};

/**
 * Component to handle fitting the map bounds.
 */
function MapBoundsFit({ endpoints }: { endpoints: EndpointWithStatus[] }) {
  const map = useMap();
  useEffect(() => {
    if (endpoints && endpoints.length > 0) {
      const coords = endpoints
        .filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')
        .map((e) => [e.lat, e.lng]);

      if (coords.length > 0) {
        try {
          const bounds = L.latLngBounds(coords);
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], animate: true });
          }
        } catch (e) {
          console.error('Error calculating map bounds:', e);
        }
      }
    }
  }, [endpoints, map]);

  return null;
}

export default function AdminDashboardMap() {
  const [data, setData] = useState<EndpointWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [endpointsRes, healthRes] = await Promise.all([
          listStorageEndpoints(),
          fetchHealthWorkspaceOverview(), 
        ]);

        const endpoints = endpointsRes || [];
        const healthEntries: Record<number, string> = {};
        
        if (healthRes?.endpoints) {
          healthRes.endpoints.forEach((e: any) => {
            if (e.endpoint_id !== undefined && e.endpoint_id !== null) {
              healthEntries[Number(e.endpoint_id)] = String(e.status);
            }
          });
        }

        const combinedData: EndpointWithStatus[] = endpoints.map((ep) => ({
          id: ep.id,
          name: ep.name,
          lat: typeof ep.latitude === 'number' ? ep.latitude : null,
          lng: typeof ep.longitude === 'number' ? ep.longitude : null,
          status: (healthEntries[ep.id] as string) || 'unknown',
        }));

        setData(combinedData);
      } catch (e: any) {
        console.error('Failed to load map data:', e);
        setError(e.message || 'Erreur lors du chargement de la carte.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const hasValidCoords = data.some((e) => typeof e.lat === 'number' && typeof e.lng === 'number');

  if (loading) return <div className='h-[250px] w-full rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center ui-caption'>Chargement de la carte...</div>;
  if (error) return <div className='h-[250px] w-full rounded-md border border-slate-200 bg-slate-50 p-8 flex items-center justify-center ui-caption text-rose-600'>{error}</div>;
  if (!hasValidCoords) return <div className='h-[250px] w-full rounded-md border border-slate-200 bg-slate-50 p-8 flex items-center justify-center ui-caption'>Aucune coordonnée GPS disponible pour les endpoints.</div>;

  return (
    <div className='h-[250px] w-full rounded-xl border border-slate-200 overflow-hidden shadow-sm bg-white dark:bg-slate-900'>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        />
        {data.map((endpoint) => {
          if (typeof endpoint.lat !== 'number' || typeof endpoint.lng !== 'number') return null;

          return (
            <CircleMarker
              key={endpoint.id}
              center={[endpoint.lat, endpoint.lng]}
              radius={6}
              pathOptions={{
                fillColor: statusColorMap[endpoint.status] || '#9ca3af',
                color: 'white',
                weight: 1,
                fillOpacity: 0.8,
              }}
            />
          );
        })}
        <MapBoundsFit endpoints={data} />
      </MapContainer>
    </div>
  );
}
