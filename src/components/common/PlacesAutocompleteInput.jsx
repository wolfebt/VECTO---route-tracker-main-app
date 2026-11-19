import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

let modernPlacesBlocked = false;

/**
 * Address autocomplete input supporting the modern Google Places API
 * (`AutocompleteSuggestion.fetchAutocompleteSuggestions`) with automatic session
 * fallback to legacy `places.Autocomplete` if disabled or unavailable.
 */
export default function PlacesAutocompleteInput({
  value,
  onChange,
  onSelectPlace,
  placeholder,
  className,
  required,
}) {
  const inputRef = useRef(null);
  const placesLib = useMapsLibrary('places');
  const onChangeRef = useRef(onChange);
  const onSelectPlaceRef = useRef(onSelectPlace);
  const sessionTokenRef = useRef(null);
  const debounceTimerRef = useRef(null);

  const [suggestions, setSuggestions] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [useLegacy, setUseLegacy] = useState(() => modernPlacesBlocked);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectPlaceRef.current = onSelectPlace;
  }, [onChange, onSelectPlace]);

  // Attach legacy places.Autocomplete only when AutocompleteSuggestion is unavailable or blocked
  useEffect(() => {
    const modernSupported = Boolean(placesLib?.AutocompleteSuggestion?.fetchAutocompleteSuggestions);
    const shouldAttachLegacy = Boolean(placesLib && (!modernSupported || useLegacy));
    if (!shouldAttachLegacy || !inputRef.current) return;

    const ac = new placesLib.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry', 'name'],
    });

    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      let formatted = '';
      if (place.formatted_address) {
        if (place.name && !place.formatted_address.startsWith(place.name)) {
          formatted = `${place.name}, ${place.formatted_address}`;
        } else {
          formatted = place.formatted_address;
        }
      } else if (place.name) {
        formatted = place.name;
      }

      const loc = place.geometry?.location;
      const lat = typeof loc?.lat === 'function' ? loc.lat() : null;
      const lng = typeof loc?.lng === 'function' ? loc.lng() : null;

      if (formatted) {
        onChangeRef.current(formatted);
        if (onSelectPlaceRef.current) {
          onSelectPlaceRef.current({ address: formatted, lat, lng });
        }
      }
    });

    return () => {
      if (window.google?.maps?.event) {
        window.google.maps.event.removeListener(listener);
      }
    };
  }, [placesLib, useLegacy]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const fetchModernSuggestions = (rawInput) => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }

    const modernFn = placesLib?.AutocompleteSuggestion?.fetchAutocompleteSuggestions;
    if (!modernFn || useLegacy || modernPlacesBlocked) return;

    const text = String(rawInput || '').trim();
    if (text.length < 2) {
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
      return;
    }

    debounceTimerRef.current = window.setTimeout(async () => {
      try {
        if (!sessionTokenRef.current && placesLib.AutocompleteSessionToken) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
        }
        const req = { input: text };
        if (sessionTokenRef.current) {
          req.sessionToken = sessionTokenRef.current;
        }
        const res = await modernFn(req);
        const list = Array.isArray(res?.suggestions) ? res.suggestions : [];
        const placePredictions = list
          .map((item) => item?.placePrediction)
          .filter(Boolean);
        setSuggestions(placePredictions);
        setDropdownOpen(placePredictions.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        const msg = String(err?.message || err || '');
        if (/PERMISSION_DENIED|ApiTargetBlocked|not enabled|API_KEY|has not been used/i.test(msg)) {
          modernPlacesBlocked = true;
          setUseLegacy(true);
        }
        setSuggestions([]);
        setDropdownOpen(false);
      }
    }, 200);
  };

  const handleSelectPrediction = async (prediction) => {
    if (!prediction) return;
    setDropdownOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);

    const fallbackText = prediction.text?.text || prediction.text?.toString?.() || '';
    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ['formattedAddress', 'displayName', 'location'],
      });
      if (placesLib?.AutocompleteSessionToken) {
        sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
      } else {
        sessionTokenRef.current = null;
      }

      const displayName = place.displayName || '';
      const formattedAddress = place.formattedAddress || '';
      let formatted = formattedAddress || displayName || fallbackText;
      if (formattedAddress && displayName && !formattedAddress.startsWith(displayName)) {
        formatted = `${displayName}, ${formattedAddress}`;
      }

      const loc = place.location;
      const lat = typeof loc?.lat === 'function' ? loc.lat() : (typeof loc?.lat === 'number' ? loc.lat : null);
      const lng = typeof loc?.lng === 'function' ? loc.lng() : (typeof loc?.lng === 'number' ? loc.lng : null);

      onChangeRef.current(formatted);
      if (onSelectPlaceRef.current) {
        onSelectPlaceRef.current({ address: formatted, lat, lng });
      }
    } catch {
      if (fallbackText) {
        onChangeRef.current(fallbackText);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (!dropdownOpen || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      handleSelectPrediction(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  };

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val);
          fetchModernSuggestions(val);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          window.setTimeout(() => setDropdownOpen(false), 160);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setDropdownOpen(true);
        }}
        placeholder={placeholder}
        className={className}
        required={required}
        autoComplete="off"
      />
      {dropdownOpen && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-50 max-h-56 overflow-y-auto divide-y divide-slate-700/60">
          {suggestions.map((pred, idx) => {
            const label = pred.text?.text || pred.text?.toString?.() || '';
            return (
              <li key={pred.placeId || idx}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectPrediction(pred);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer ${
                    idx === activeIndex
                      ? 'bg-sky-600/30 text-white font-semibold'
                      : 'text-slate-200 hover:bg-slate-700/80'
                  }`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
