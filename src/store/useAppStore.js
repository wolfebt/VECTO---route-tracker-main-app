import { create } from 'zustand';

export const useAppStore = create((set) => ({
  // Auth & User State
  currentUser: null,
  isAuthReady: false,
  setCurrentUser: (user) => set({ currentUser: user, isAuthReady: true }),
  mapsApiKey: '',
  setMapsApiKey: (key) => set({ mapsApiKey: key }),

  // Company State
  companyId: null,
  companyName: null,
  isDispatchView: false,
  setCompany: (id, name, isDispatch) => set({ 
    companyId: id, 
    companyName: name, 
    isDispatchView: isDispatch 
  }),
  clearCompany: () => set({ companyId: null, companyName: null, isDispatchView: false }),

  // UI & Job State
  activeJobTab: 'current',
  setActiveJobTab: (tab) => set({ activeJobTab: tab }),
  selectedJobId: null,
  setSelectedJobId: (id) => set({ selectedJobId: id, routeInfo: null }),
  
  routeInfo: null,
  setRouteInfo: (info) => set({ routeInfo: info }),

  isSharingLocation: false,
  setIsSharingLocation: (isSharing) => set({ isSharingLocation: isSharing }),

  // Modals & UI State
  modals: {
    company: false,
    companyPassword: null, // Holds companyId if asking for password, else null
    settings: false,
    profile: false,
    userGuide: false,
    invite: false,
    adminSettings: false,
    companySettings: false,
    createJob: false,
    confirm: null, // Holds { message, onConfirm } or null
  },
  openModal: (modalName, data = true) => set((state) => ({ 
    modals: { ...state.modals, [modalName]: data } 
  })),
  closeModal: (modalName) => set((state) => ({ 
    modals: { ...state.modals, [modalName]: false } 
  })),

  // Constants
  colors: ['#FF5733', '#33FF57', '#3357FF', '#FF33A1', '#A133FF', '#33FFA1', '#FFC300', '#C70039'],
}));
