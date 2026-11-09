import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { CATEGORY_LABELS } from '../labels.js';

// Change to your campus coordinates
const DEFAULT_CENTER = [14.1985835,120.8827,17];

function FlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target?.lat != null) map.flyTo([target.lat, target.lng], 18, { duration: 0.8 });
  }, [target, map]);
  return null;
}

export default function MapView({ incidents, selectedId, onSelect }) {
  const selected = incidents.find((i) => i._id === selectedId);
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={16} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FlyTo target={selected?.location} />
      {incidents
        .filter((i) => i.location?.lat != null)
        .map((i) => (
          <CircleMarker
            key={i._id}
            center={[i.location.lat, i.location.lng]}
            radius={i._id === selectedId ? 16 : 11}
            pathOptions={{ color: '#fff', weight: 3, fillColor: i.status === 'PENDING' ? '#c4122f' : '#8a5a00', fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect(i._id) }}
          >
            <Popup>{CATEGORY_LABELS[i.category]}{i.location.description ? `: ${i.location.description}` : ''}</Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
}
