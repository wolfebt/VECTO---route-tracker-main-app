/**
 * Google Places Address Autocomplete adapter supporting:
 * 1. Modern Places API (New): `AutocompleteSuggestion.fetchAutocompleteSuggestions`
 * 2. Legacy Places API programmatic service: `AutocompleteService` + `PlacesService`
 * 3. Legacy Places Autocomplete widget fallback: `places.Autocomplete`
 * 4. Last-resort Geocoder fallback when both Places APIs are blocked on the key
 */

let modernPlacesBlocked = false;
let legacyServiceBlocked = false;
let loggedPlacesWarning = false;

export function resetPlacesAutocompleteState() {
  modernPlacesBlocked = false;
  legacyServiceBlocked = false;
  loggedPlacesWarning = false;
}

export function isModernPlacesBlocked() {
  return modernPlacesBlocked;
}

export function isLegacyServiceBlocked() {
  return legacyServiceBlocked;
}

function extractText(val) {
  if (typeof val === 'string') return val.trim();
  if (val && typeof val.text === 'string') return val.text.trim();
  return '';
}

export function formatPlaceAddress(displayName, formattedAddress, fallbackText = '') {
  const name = extractText(displayName);
  const formatted = extractText(formattedAddress);
  const fallback = extractText(fallbackText);

  if (formatted) {
    if (name && !formatted.toLowerCase().startsWith(name.toLowerCase())) {
      return `${name}, ${formatted}`;
    }
    return formatted;
  }
  return name || fallback;
}

export function extractLatLng(loc) {
  if (!loc) return { lat: null, lng: null };
  const rawLat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
  const rawLng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
  const lat = typeof rawLat === 'number' && Number.isFinite(rawLat) ? rawLat : null;
  const lng = typeof rawLng === 'number' && Number.isFinite(rawLng) ? rawLng : null;
  return { lat, lng };
}

function isPlacesAccessError(err) {
  const combined = [
    err?.code,
    err?.status,
    err?.name,
    err?.message,
    err != null ? String(err) : '',
  ]
    .filter(Boolean)
    .join(' ');
  return /PERMISSION_DENIED|REQUEST_DENIED|ApiTargetBlocked|ApiNotActivated|SERVICE_DISABLED|AccessNotConfigured|FORBIDDEN|\b403\b|not enabled|not authorized|API_KEY|has not been used|disabled|Places API \(New\)/i.test(
    combined
  );
}

function queryLegacyPredictions(service, request, placesLib, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ status: 'TIMEOUT', predictions: [] });
      }
    }, timeoutMs);

    try {
      service.getPlacePredictions(request, (predictions, status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status, predictions: Array.isArray(predictions) ? predictions : [] });
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'ERROR', error: err, predictions: [] });
      }
    }
  });
}

function queryLegacyPlaceDetails(service, request, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ status: 'TIMEOUT', place: null });
      }
    }, timeoutMs);

    try {
      service.getDetails(request, (place, status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status, place: place || null });
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'ERROR', error: err, place: null });
      }
    }
  });
}

function geocodeAddressList(address, maxResults = 5, timeoutMs = 4000) {
  if (typeof window === 'undefined' || typeof window.google?.maps?.Geocoder !== 'function') {
    return Promise.resolve([]);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve([]);
      }
    }, timeoutMs);

    try {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (status === 'OK' && Array.isArray(results)) {
          resolve(results.slice(0, maxResults));
          return;
        }
        resolve([]);
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve([]);
      }
    }
  });
}

function isStatusOk(status, placesLib) {
  return status === 'OK' || (placesLib?.PlacesServiceStatus?.OK && status === placesLib.PlacesServiceStatus.OK);
}

function isStatusZeroResults(status, placesLib) {
  return (
    status === 'ZERO_RESULTS' ||
    (placesLib?.PlacesServiceStatus?.ZERO_RESULTS && status === placesLib.PlacesServiceStatus.ZERO_RESULTS)
  );
}

function isStatusRequestDenied(status, placesLib) {
  return (
    status === 'REQUEST_DENIED' ||
    (placesLib?.PlacesServiceStatus?.REQUEST_DENIED && status === placesLib.PlacesServiceStatus.REQUEST_DENIED)
  );
}

export async function fetchAddressSuggestions({
  input,
  placesLib,
  sessionToken = null,
  autocompleteServiceRef = null,
}) {
  const text = String(input || '').trim();
  if (text.length < 2) {
    return { suggestions: [], mode: 'none', fallbackToWidget: false, resetToken: false };
  }

  let resetToken = false;

  // Tier 1: Modern Places API (New) — always invoke static method on AutocompleteSuggestion to preserve `this`
  const hasModern = typeof placesLib?.AutocompleteSuggestion?.fetchAutocompleteSuggestions === 'function';
  if (!modernPlacesBlocked && hasModern) {
    try {
      const req = { input: text };
      if (sessionToken) {
        req.sessionToken = sessionToken;
      }
      const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
      const list = Array.isArray(res?.suggestions) ? res.suggestions : [];
      const suggestions = list
        .map((item, idx) => {
          const pred = item?.placePrediction;
          if (!pred) return null;
          const fullText = pred.text?.text || pred.text?.toString?.() || '';
          const mainText = pred.mainText?.text || pred.structuredFormat?.mainText?.text || '';
          const secondaryText = pred.secondaryText?.text || pred.structuredFormat?.secondaryText?.text || '';
          return {
            id: pred.placeId || `modern_${idx}`,
            source: 'modern',
            mainText,
            secondaryText,
            fullText,
            placePrediction: pred,
          };
        })
        .filter(Boolean);

      return { suggestions, mode: 'modern', fallbackToWidget: false, resetToken: false };
    } catch (err) {
      if (isPlacesAccessError(err)) {
        modernPlacesBlocked = true;
        resetToken = true;
      } else {
        console.warn('[PlacesAutocomplete] Modern Places suggestion request failed:', err);
        return { suggestions: [], mode: 'modern', fallbackToWidget: false, resetToken: false };
      }
    }
  }

  // Tier 2: Legacy AutocompleteService (programmatic predictions for custom dropdown)
  const hasLegacyService = typeof placesLib?.AutocompleteService === 'function';
  if (!legacyServiceBlocked && hasLegacyService) {
    try {
      const service = autocompleteServiceRef?.current || new placesLib.AutocompleteService();
      if (autocompleteServiceRef && !autocompleteServiceRef.current) {
        autocompleteServiceRef.current = service;
      }
      const req = { input: text };
      if (sessionToken && !resetToken) {
        req.sessionToken = sessionToken;
      }
      const { status, predictions, error } = await queryLegacyPredictions(service, req, placesLib);

      if (isStatusOk(status, placesLib)) {
        const suggestions = predictions.map((p, idx) => ({
          id: p.place_id || `legacy_${idx}`,
          placeId: p.place_id || '',
          source: 'legacy_service',
          mainText: p.structured_formatting?.main_text || p.description || '',
          secondaryText: p.structured_formatting?.secondary_text || '',
          fullText: p.description || '',
        }));
        return { suggestions, mode: 'legacy_service', fallbackToWidget: false, resetToken };
      }

      if (isStatusZeroResults(status, placesLib)) {
        return { suggestions: [], mode: 'legacy_service', fallbackToWidget: false, resetToken };
      }

      if (isStatusRequestDenied(status, placesLib) || (error && isPlacesAccessError(error))) {
        legacyServiceBlocked = true;
        if (!loggedPlacesWarning) {
          loggedPlacesWarning = true;
          console.warn(
            '[PlacesAutocomplete] Google Places autocomplete is denied for this API key. Enable "Places API (New)" in Google Cloud Console; falling back to Geocoder.'
          );
        }
      } else {
        if (error || status !== 'TIMEOUT') {
          console.warn('[PlacesAutocomplete] Legacy AutocompleteService failed with status:', status, error);
        }
        return { suggestions: [], mode: 'legacy_service', fallbackToWidget: false, resetToken };
      }
    } catch (err) {
      if (isPlacesAccessError(err)) {
        legacyServiceBlocked = true;
        if (!loggedPlacesWarning) {
          loggedPlacesWarning = true;
          console.warn(
            '[PlacesAutocomplete] Google Places autocomplete is denied for this API key. Enable "Places API (New)" in Google Cloud Console; falling back to Geocoder.'
          );
        }
      } else {
        console.warn('[PlacesAutocomplete] Legacy AutocompleteService threw an error:', err);
        return { suggestions: [], mode: 'legacy_service', fallbackToWidget: false, resetToken };
      }
    }
  }

  // Tier 3: Legacy places.Autocomplete DOM widget (when AutocompleteService is unavailable/unprovided)
  const hasLegacyWidget = typeof placesLib?.Autocomplete === 'function';
  if (!legacyServiceBlocked && hasLegacyWidget) {
    return { suggestions: [], mode: 'legacy_widget', fallbackToWidget: true, resetToken };
  }

  // Tier 4: Last-resort Geocoder fallback when both Places APIs are blocked or absent
  const modernUnavailable = !hasModern || modernPlacesBlocked;
  const legacyServiceUnavailable = !hasLegacyService || legacyServiceBlocked;
  const legacyWidgetUnavailable = !hasLegacyWidget || legacyServiceBlocked;

  if (
    modernUnavailable &&
    legacyServiceUnavailable &&
    legacyWidgetUnavailable &&
    text.length >= 3 &&
    typeof window !== 'undefined' &&
    typeof window.google?.maps?.Geocoder === 'function'
  ) {
    const results = await geocodeAddressList(text, 5);
    const suggestions = results
      .map((r, idx) => {
        const formatted = extractText(r?.formatted_address);
        if (!formatted) return null;
        const { lat, lng } = extractLatLng(r?.geometry?.location);
        return {
          id: r.place_id || `geo_${idx}`,
          source: 'geocoder',
          mainText: formatted,
          secondaryText: '',
          fullText: formatted,
          lat,
          lng,
        };
      })
      .filter(Boolean);
    return { suggestions, mode: 'geocoder', fallbackToWidget: false, resetToken };
  }

  return { suggestions: [], mode: 'none', fallbackToWidget: false, resetToken };
}

export async function resolveAddressSuggestion({
  suggestion,
  placesLib,
  sessionToken = null,
  placesServiceDivRef = null,
}) {
  if (!suggestion) {
    return { address: '', lat: null, lng: null, rotateSessionToken: false };
  }

  const fallbackText = suggestion.fullText || suggestion.mainText || '';

  if (suggestion.source === 'modern') {
    try {
      const place = suggestion.placePrediction?.toPlace?.();
      if (!place) {
        return { address: fallbackText, lat: null, lng: null, rotateSessionToken: true };
      }
      await place.fetchFields({
        fields: ['formattedAddress', 'displayName', 'location'],
      });
      const address = formatPlaceAddress(place.displayName, place.formattedAddress, fallbackText);
      const { lat, lng } = extractLatLng(place.location);
      return { address, lat, lng, rotateSessionToken: true };
    } catch {
      return { address: fallbackText, lat: null, lng: null, rotateSessionToken: true };
    }
  }

  if (suggestion.source === 'legacy_service') {
    if (suggestion.placeId && typeof placesLib?.PlacesService === 'function') {
      try {
        let containerEl = placesServiceDivRef?.current;
        if (!containerEl && typeof document !== 'undefined') {
          containerEl = document.createElement('div');
          if (placesServiceDivRef) {
            placesServiceDivRef.current = containerEl;
          }
        }
        const service = new placesLib.PlacesService(containerEl || {});
        const req = {
          placeId: suggestion.placeId,
          fields: ['formatted_address', 'geometry', 'name'],
        };
        if (sessionToken) {
          req.sessionToken = sessionToken;
        }
        const { status, place } = await queryLegacyPlaceDetails(service, req);
        if (isStatusOk(status, placesLib) && place) {
          const address = formatPlaceAddress(place.name, place.formatted_address, fallbackText);
          const { lat, lng } = extractLatLng(place.geometry?.location);
          return { address, lat, lng, rotateSessionToken: true };
        }
      } catch {
        // Fall through to Geocoder fallback below
      }
    }

    if (fallbackText) {
      const results = await geocodeAddressList(fallbackText, 1, 3000);
      if (results[0]?.geometry?.location) {
        const { lat, lng } = extractLatLng(results[0].geometry.location);
        return { address: fallbackText, lat, lng, rotateSessionToken: true };
      }
    }
    return { address: fallbackText, lat: null, lng: null, rotateSessionToken: true };
  }

  if (suggestion.source === 'geocoder') {
    return {
      address: fallbackText,
      lat: typeof suggestion.lat === 'number' ? suggestion.lat : null,
      lng: typeof suggestion.lng === 'number' ? suggestion.lng : null,
      rotateSessionToken: false,
    };
  }

  return { address: fallbackText, lat: null, lng: null, rotateSessionToken: false };
}
