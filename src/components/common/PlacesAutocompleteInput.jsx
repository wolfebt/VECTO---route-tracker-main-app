import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Loader2, MapPin } from 'lucide-react';
import {
  extractLatLng,
  fetchAddressSuggestions,
  formatPlaceAddress,
  isLegacyServiceBlocked,
  isModernPlacesBlocked,
  resolveAddressSuggestion,
} from '../../utils/placesAutocomplete';

/**
 * Address autocomplete input supporting Google Places API (New)
 * (`AutocompleteSuggestion.fetchAutocompleteSuggestions`) with automatic session
 * fallback to `AutocompleteService` + `PlacesService`, legacy `places.Autocomplete`,
 * and `Geocoder` when Places APIs are restricted or unavailable.
 */
export default function PlacesAutocompleteInput({
  id,
  name,
  'aria-label': ariaLabel,
  value,
  onChange,
  onSelectPlace,
  placeholder,
  className,
  required,
}) {
  const reactId = useId();
  const listboxId = `${reactId}-listbox`;

  const inputRef = useRef(null);
  const placesLib = useMapsLibrary('places');
  const placesLibRef = useRef(placesLib);
  const onChangeRef = useRef(onChange);
  const onSelectPlaceRef = useRef(onSelectPlace);
  const sessionTokenRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const blurTimerRef = useRef(null);
  const autocompleteServiceRef = useRef(null);
  const placesServiceDivRef = useRef(null);
  const requestIdRef = useRef(0);
  const pendingQueryRef = useRef('');
  const mountedRef = useRef(true);

  const [suggestions, setSuggestions] = useState([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [useLegacyWidget, setUseLegacyWidget] = useState(false);

  const hasModern = Boolean(placesLib?.AutocompleteSuggestion?.fetchAutocompleteSuggestions);
  const hasLegacyService = Boolean(placesLib?.AutocompleteService);
  const hasLegacyWidget = Boolean(placesLib?.Autocomplete);
  const modernUnavailable = !hasModern || isModernPlacesBlocked();
  const shouldAttachLegacyWidget = Boolean(
    placesLib &&
      hasLegacyWidget &&
      !isLegacyServiceBlocked() &&
      (useLegacyWidget || (modernUnavailable && !hasLegacyService))
  );
  const shouldAttachLegacyWidgetRef = useRef(shouldAttachLegacyWidget);

  useEffect(() => {
    placesLibRef.current = placesLib;
    shouldAttachLegacyWidgetRef.current = shouldAttachLegacyWidget;
  }, [placesLib, shouldAttachLegacyWidget]);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectPlaceRef.current = onSelectPlace;
  }, [onChange, onSelectPlace]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  // Attach legacy places.Autocomplete DOM widget only when neither modern nor AutocompleteService is usable
  useEffect(() => {
    if (!shouldAttachLegacyWidget || !inputRef.current) return;

    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    setIsLoading(false);

    const ac = new placesLib.Autocomplete(inputRef.current, {
      fields: ['formatted_address', 'geometry', 'name'],
    });

    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      const formatted = formatPlaceAddress(place?.name, place?.formatted_address);
      const { lat, lng } = extractLatLng(place?.geometry?.location);

      if (formatted) {
        pendingQueryRef.current = '';
        onChangeRef.current?.(formatted);
        onSelectPlaceRef.current?.({ address: formatted, lat, lng });
      }
    });

    return () => {
      if (window.google?.maps?.event) {
        if (listener) {
          window.google.maps.event.removeListener(listener);
        }
        if (typeof window.google.maps.event.clearInstanceListeners === 'function') {
          window.google.maps.event.clearInstanceListeners(ac);
        }
      }
    };
  }, [placesLib, shouldAttachLegacyWidget]);

  const scheduleFetch = useCallback((rawInput) => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    requestIdRef.current += 1;
    const reqId = requestIdRef.current;

    if (shouldAttachLegacyWidgetRef.current) {
      setIsLoading(false);
      return;
    }

    const text = String(rawInput || '').trim();
    if (text.length < 2) {
      pendingQueryRef.current = '';
      setSuggestions([]);
      setDropdownOpen(false);
      setActiveIndex(-1);
      setIsLoading(false);
      return;
    }

    const lib = placesLibRef.current;
    const geocoderAvailable =
      typeof window !== 'undefined' && typeof window.google?.maps?.Geocoder === 'function';
    const canFallbackToGeocoder =
      isModernPlacesBlocked() && isLegacyServiceBlocked() && geocoderAvailable;

    if (!lib && !canFallbackToGeocoder) {
      pendingQueryRef.current = rawInput;
      return;
    }

    pendingQueryRef.current = '';
    const inGeocoderMode =
      !lib ||
      (isModernPlacesBlocked() &&
        (!lib?.AutocompleteService || isLegacyServiceBlocked()) &&
        (!lib?.Autocomplete || isLegacyServiceBlocked()));
    const delayMs = inGeocoderMode ? 350 : 200;

    setIsLoading(true);
    debounceTimerRef.current = window.setTimeout(async () => {
      try {
        const currentLib = placesLibRef.current;
        if (!sessionTokenRef.current && currentLib?.AutocompleteSessionToken) {
          sessionTokenRef.current = new currentLib.AutocompleteSessionToken();
        }

        const result = await fetchAddressSuggestions({
          input: text,
          placesLib: currentLib,
          sessionToken: sessionTokenRef.current,
          autocompleteServiceRef,
        });

        if (!mountedRef.current || reqId !== requestIdRef.current) return;

        if (result.resetToken) {
          sessionTokenRef.current = null;
        }

        if (result.fallbackToWidget) {
          setUseLegacyWidget(true);
          setSuggestions([]);
          setDropdownOpen(false);
          setActiveIndex(-1);
          return;
        }

        const rect = inputRef.current?.getBoundingClientRect?.();
        if (
          rect &&
          (rect.height > 0 || rect.width > 0) &&
          typeof window !== 'undefined' &&
          window.innerHeight > 0
        ) {
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          setOpenUpward(spaceBelow < 220 && spaceAbove > spaceBelow);
        } else {
          setOpenUpward(false);
        }

        setSuggestions(result.suggestions);
        setDropdownOpen(result.suggestions.length > 0);
        setActiveIndex(-1);
      } finally {
        if (mountedRef.current && reqId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, delayMs);
  }, []);

  // Re-run queued input if user typed before the Google Maps Places library finished loading
  useEffect(() => {
    if (!placesLib || shouldAttachLegacyWidget) return;
    const pending = pendingQueryRef.current;
    if (pending && String(pending).trim().length >= 2) {
      pendingQueryRef.current = '';
      scheduleFetch(pending);
    }
  }, [placesLib, shouldAttachLegacyWidget, scheduleFetch]);

  const handleSelectSuggestion = async (item) => {
    if (!item) return;

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }

    requestIdRef.current += 1;
    pendingQueryRef.current = '';
    setIsLoading(false);
    setDropdownOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);

    const lib = placesLibRef.current;
    const resolved = await resolveAddressSuggestion({
      suggestion: item,
      placesLib: lib,
      sessionToken: sessionTokenRef.current,
      placesServiceDivRef,
    });

    if (!mountedRef.current) return;

    if (resolved.rotateSessionToken) {
      sessionTokenRef.current = lib?.AutocompleteSessionToken
        ? new lib.AutocompleteSessionToken()
        : null;
    }

    if (resolved.address) {
      onChangeRef.current?.(resolved.address);
      onSelectPlaceRef.current?.({
        address: resolved.address,
        lat: resolved.lat,
        lng: resolved.lng,
      });
    }
  };

  const handleKeyDown = (e) => {
    if (shouldAttachLegacyWidget) {
      if (
        e.key === 'Enter' &&
        typeof document !== 'undefined' &&
        document.querySelector('.pac-container .pac-item-selected')
      ) {
        e.preventDefault();
      }
      return;
    }

    if (!dropdownOpen || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDropdownOpen(false);
      setActiveIndex(-1);
    } else if (e.key === 'Tab') {
      setDropdownOpen(false);
      setActiveIndex(-1);
    }
  };

  const isDropdownVisible = dropdownOpen && suggestions.length > 0;

  return (
    <div className={`relative w-full ${isDropdownVisible ? 'z-[70]' : ''}`}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        aria-label={ariaLabel}
        type="text"
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val);
          scheduleFetch(val);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (blurTimerRef.current) {
            window.clearTimeout(blurTimerRef.current);
          }
          blurTimerRef.current = window.setTimeout(() => {
            if (mountedRef.current) {
              setDropdownOpen(false);
            }
          }, 200);
        }}
        onFocus={() => {
          if (blurTimerRef.current) {
            window.clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
          }
          if (suggestions.length > 0) {
            setDropdownOpen(true);
          }
        }}
        placeholder={placeholder}
        className={`${className || ''} pr-8`}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={isDropdownVisible}
        aria-autocomplete="list"
        aria-controls={isDropdownVisible ? listboxId : undefined}
        aria-activedescendant={
          isDropdownVisible && activeIndex >= 0 && suggestions[activeIndex]
            ? `${reactId}-option-${activeIndex}`
            : undefined
        }
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 flex items-center">
        {isLoading ? (
          <Loader2 size={14} className="animate-spin text-sky-400" aria-hidden="true" />
        ) : (
          <MapPin size={14} className="opacity-60" aria-hidden="true" />
        )}
      </span>
      {isDropdownVisible && (
        <ul
          id={listboxId}
          role="listbox"
          className={`absolute left-0 right-0 ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          } bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-[80] max-h-56 overflow-y-auto divide-y divide-slate-700/60`}
        >
          {suggestions.map((item, idx) => {
            const isSelected = idx === activeIndex;
            return (
              <li
                key={item.id || idx}
                id={`${reactId}-option-${idx}`}
                role="option"
                aria-selected={isSelected}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectSuggestion(item)}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer flex items-start gap-2 ${
                    isSelected
                      ? 'bg-sky-600/30 text-white'
                      : 'text-slate-200 hover:bg-slate-700/80'
                  }`}
                >
                  <MapPin size={13} className="shrink-0 mt-0.5 text-sky-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 leading-snug">
                    {item.mainText ? (
                      <>
                        <span className="font-semibold text-white block truncate">
                          {item.mainText}
                        </span>
                        {item.secondaryText && (
                          <span className="text-[11px] text-slate-400 block truncate">
                            {item.secondaryText}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="block truncate">{item.fullText}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
          <li
            role="presentation"
            className="px-3 py-1 bg-slate-900/80 text-[10px] text-slate-400 flex items-center justify-end gap-1 select-none"
          >
            Powered by Google
          </li>
        </ul>
      )}
    </div>
  );
}
