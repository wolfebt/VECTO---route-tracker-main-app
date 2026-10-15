import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';

/**
 * Manages native Android/iOS system behaviors:
 * - Status bar styling & dark-theme harmonization
 * - Hierarchical hardware & gesture back button handling
 * - Double-tap back button confirmation to exit
 */
export function useNativeDevice() {
  const lastBackPressRef = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // 1. Status Bar Setup
    try {
      StatusBar.setStyle({ style: Style.Dark }).catch((err) => console.warn('StatusBar style set error:', err));
      StatusBar.setBackgroundColor({ color: '#0b0f19' }).catch((err) => console.warn('StatusBar bg set error:', err));
    } catch (e) {
      console.warn('StatusBar setup error:', e);
    }

    // 2. Hardware / Gesture Back Button Handling
    let backListenerSubscription = null;
    try {
      App.addListener('backButton', () => {
        const state = useAppStore.getState();

        // Step 1: Check for open modals and close the topmost active one
        const activeModalKey = Object.keys(state.modals).find((key) => {
          const val = state.modals[key];
          return val === true || (typeof val === 'object' && val !== null);
        });

        if (activeModalKey) {
          state.closeModal(activeModalKey);
          return;
        }

        // Step 2: If viewing a selected job, step back to jobs list
        if (state.selectedJobId) {
          state.setSelectedJobId(null);
          state.setMobileView('sidebar');
          return;
        }

        // Step 3: If in Operations Board view, step back to Map view
        if (state.mainView === 'operations') {
          state.setMainView('map');
          return;
        }

        // Step 4: If on Mobile Map view, switch back to sidebar
        if (state.mobileView === 'map') {
          state.setMobileView('sidebar');
          return;
        }

        // Step 5: Double-press back button to exit
        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          App.exitApp();
        } else {
          lastBackPressRef.current = now;
          useToastStore.getState().addToast('Press back again to exit', 'info');
        }
      }).then((sub) => {
        backListenerSubscription = sub;
      }).catch((err) => {
        console.warn('Could not register backButton listener:', err);
      });
    } catch (e) {
      console.warn('App backButton listener setup failed:', e);
    }

    return () => {
      if (backListenerSubscription) {
        backListenerSubscription.remove();
      }
    };
  }, []);
}
