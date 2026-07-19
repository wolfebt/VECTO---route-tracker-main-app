import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';

export function useVoiceCommands() {
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState(null);
  
  const openModal = useAppStore(state => state.openModal);
  const setSelectedJobId = useAppStore(state => state.setSelectedJobId);
  const addToast = useToastStore(state => state.addToast);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition not supported in this browser.");
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onstart = () => setIsListening(true);
    rec.onend = () => setIsListening(false);
    rec.onerror = (e) => {
        console.error("Speech recognition error:", e.error);
        if (e.error !== 'no-speech') {
            setIsListening(false);
        }
    };

    rec.onresult = (event) => {
      const lastResultIndex = event.results.length - 1;
      const transcript = event.results[lastResultIndex][0].transcript.trim().toLowerCase();
      console.log("Voice Command heard:", transcript);

      if (transcript.includes("create job") || transcript.includes("new job")) {
          openModal('createJob');
          addToast("Opening Create Job", "success");
      } else if (transcript.includes("settings")) {
          openModal('settings');
          addToast("Opening Settings", "success");
      } else if (transcript.includes("close")) {
          openModal(null);
          setSelectedJobId(null);
          addToast("Closing view", "success");
      } else if (transcript.includes("my location") || transcript.includes("where am i")) {
          if (navigator.geolocation) {
             navigator.geolocation.getCurrentPosition((pos) => {
                window.dispatchEvent(new CustomEvent('recenter-map', {
                  detail: { lat: pos.coords.latitude, lng: pos.coords.longitude }
                }));
             }, (err) => console.warn(err), { enableHighAccuracy: true, maximumAge: 0 });
          }
          addToast("Centering map", "success");
      }
    };

    setRecognition(rec);
    return () => {
        rec.stop();
    };
  }, [openModal, setSelectedJobId, addToast]);

  const toggleListening = useCallback(() => {
    if (!recognition) {
        addToast("Voice commands are not supported in your browser.", "error");
        return;
    }
    if (isListening) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch (e) {
        console.error(e);
      }
    }
  }, [isListening, recognition, addToast]);

  return { isListening, toggleListening, supported: !!recognition };
}
