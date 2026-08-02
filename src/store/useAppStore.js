import { create } from 'zustand';

export const useAppStore = create((set) => ({
  // Auth & User State
  currentUser: null,
  isAuthReady: false,
  setCurrentUser: (user) => set({ currentUser: user, isAuthReady: true }),
  mapsApiKey: '',
  setMapsApiKey: (key) => set({ mapsApiKey: key }),
  firebaseApiKey: '',
  setFirebaseApiKey: (key) => set({ firebaseApiKey: key }),
  geminiApiKey: '',
  setGeminiApiKey: (key) => set({ geminiApiKey: key }),
  showSplash: true,
  fadeSplash: false,
  setShowSplash: (show) => set({ showSplash: show }),
  setFadeSplash: (fade) => set({ fadeSplash: fade }),
  triggerSplash: () => set({ showSplash: true, fadeSplash: false }),

  // Company State
  companyId: null,
  companyName: null,
  isDispatchView: false,
  setCompany: (id, name, isDispatch) => {
    if (id) {
      try { localStorage.setItem('vecto_last_company_id', id); } catch (e) { console.warn(e); }
    }
    set({ companyId: id, companyName: name, isDispatchView: isDispatch });
  },
  clearCompany: () => {
    try { 
      localStorage.removeItem('vecto_last_company_id'); 
      sessionStorage.setItem('vecto_has_cleared_company', 'true');
    } catch (e) { console.warn(e); }
    set({ companyId: null, companyName: null, isDispatchView: false });
  },

  // UI & Job State
  mobileView: 'sidebar', // 'sidebar' | 'map'
  setMobileView: (view) => set({ mobileView: view }),
  activeJobTab: 'current',
  setActiveJobTab: (tab) => set({ activeJobTab: tab }),
  selectedJobId: null,
  setSelectedJobId: (id) => set({ selectedJobId: id, routeInfo: null }),
  
  routeInfo: null,
  setRouteInfo: (info) => set({ routeInfo: info }),

  routeStyle: 'alternating', // 'alternating' (fade color to transparent road & back) | 'outlined' | 'traffic' | 'solid'
  setRouteStyle: (style) => set({ routeStyle: style }),
  showTrafficLayer: true,
  setShowTrafficLayer: (show) => set({ showTrafficLayer: show }),

  isSharingLocation: true,
  setIsSharingLocation: (isSharing) => set({ isSharingLocation: isSharing }),

  // Modals & UI State
  modals: {
    company: false,
    companyPassword: null, // Holds companyId if asking for password, else null
    settings: false,
    mapSettings: false,
    profile: false,
    userGuide: false,
    technicals: false,
    development: false,
    invite: false,
    adminSettings: false,
    companySettings: false,
    createJob: false,
    jobReport: false,
    logProgress: false,
    confirm: null, // Holds { message, onConfirm } or null
    stressTest: false, // Dashboard modal
  },
  openModal: (modalName, data = true) => set((state) => ({ 
    modals: { ...state.modals, [modalName]: data } 
  })),
  closeModal: (modalName) => set((state) => ({ 
    modals: { ...state.modals, [modalName]: false } 
  })),

  // Stress Test Mode
  isMockMode: false,
  setIsMockMode: (isMockMode) => set({ isMockMode }),
  mockDrivers: [],
  setMockDrivers: (mockDrivers) => set({ mockDrivers }),
  mockJobs: [],
  setMockJobs: (mockJobs) => set({ mockJobs }),

  // Constants
  colors: ['#FF5733', '#33FF57', '#3357FF', '#FF33A1', '#A133FF', '#33FFA1', '#FFC300', '#C70039'],
}));
