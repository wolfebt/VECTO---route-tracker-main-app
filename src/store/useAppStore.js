import { create } from 'zustand';
import { mergeActiveAndArchivedJobs } from '../utils/jobsMerge';

const DEFAULT_PERMISSIONS = {
  canCreateJob: false,
  canDeleteJob: false,
  canManageDrivers: false,
  isCreator: false
};

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
  memberPermissions: { ...DEFAULT_PERMISSIONS },
  setMemberPermissions: (perms) => set({ memberPermissions: { ...DEFAULT_PERMISSIONS, ...perms } }),
  showNameplates: true,
  setShowNameplates: (showNameplates) => set({ showNameplates }),
  jobs: [],
  activeJobs: [],
  archivedJobs: [],
  hasMoreArchivedJobs: false,
  loadingArchivedJobs: false,
  archivedJobsLoadedOnce: false,
  setJobs: (jobs) => set({ jobs }),
  setActiveJobs: (activeJobs) =>
    set((state) => {
      const activeIds = new Set((activeJobs || []).map((j) => j.id));
      const cleanedArchived = (state.archivedJobs || []).filter((j) => !activeIds.has(j.id));
      return {
        activeJobs,
        archivedJobs: cleanedArchived,
        jobs: mergeActiveAndArchivedJobs(activeJobs, cleanedArchived),
      };
    }),
  setArchivedJobsState: (patch) =>
    set((state) => {
      const nextArchived = patch.archivedJobs !== undefined ? patch.archivedJobs : state.archivedJobs;
      return {
        archivedJobs: nextArchived,
        jobs: mergeActiveAndArchivedJobs(state.activeJobs, nextArchived),
        ...(patch.hasMoreArchivedJobs !== undefined ? { hasMoreArchivedJobs: patch.hasMoreArchivedJobs } : {}),
        ...(patch.loadingArchivedJobs !== undefined ? { loadingArchivedJobs: patch.loadingArchivedJobs } : {}),
        ...(patch.archivedJobsLoadedOnce !== undefined ? { archivedJobsLoadedOnce: patch.archivedJobsLoadedOnce } : {}),
      };
    }),
  members: [],
  setMembers: (members) => set({ members }),
  activeDrivers: [],
  setActiveDrivers: (activeDrivers) => set({ activeDrivers }),
  vehicles: [],
  setVehicles: (vehicles) => set({ vehicles }),
  inspections: [],
  setInspections: (inspections) => set({ inspections }),
  setCompany: (id, name, isDispatch) => {
    if (id) {
      try { localStorage.setItem('vecto_last_company_id', id); } catch (e) { console.warn(e); }
    }
    set((state) => ({
      companyId: id,
      companyName: name,
      isDispatchView: isDispatch,
      ...(id !== state.companyId
        ? {
            jobs: [],
            activeJobs: [],
            archivedJobs: [],
            hasMoreArchivedJobs: false,
            loadingArchivedJobs: false,
            archivedJobsLoadedOnce: false,
          }
        : {}),
    }));
  },
  clearCompany: () => {
    try { 
      localStorage.removeItem('vecto_last_company_id'); 
      sessionStorage.setItem('vecto_has_cleared_company', 'true');
    } catch (e) { console.warn(e); }
    set({
      companyId: null,
      companyName: null,
      isDispatchView: false,
      memberPermissions: { ...DEFAULT_PERMISSIONS },
      showNameplates: true,
      jobs: [],
      activeJobs: [],
      archivedJobs: [],
      hasMoreArchivedJobs: false,
      loadingArchivedJobs: false,
      archivedJobsLoadedOnce: false,
      members: [],
      activeDrivers: [],
      vehicles: [],
      inspections: [],
      selectedJobId: null,
      routeInfo: null
    });
  },

  // UI & Job State
  mainView: 'map', // 'map' | 'operations'
  setMainView: (view) => set({ mainView: view }),
  mobileView: 'sidebar', // 'sidebar' | 'map'
  setMobileView: (view) => set({ mobileView: view }),
  activeJobTab: 'current',
  setActiveJobTab: (tab) => set({ activeJobTab: tab }),
  jobSearchQuery: '',
  setJobSearchQuery: (jobSearchQuery) => set({ jobSearchQuery }),
  jobFilter: 'all', // 'all' | 'mine' | 'open'
  setJobFilter: (jobFilter) => set({ jobFilter }),
  selectedJobId: null,
  setSelectedJobId: (id) => set({ selectedJobId: id, routeInfo: null }),
  
  routeInfo: null,
  setRouteInfo: (info) => set({ routeInfo: info }),

  routeStyle: 'alternating', // 'alternating' | 'outlined' | 'traffic' | 'solid'
  setRouteStyle: (style) => set({ routeStyle: style }),
  showTrafficLayer: true,
  setShowTrafficLayer: (show) => set({ showTrafficLayer: show }),
  showAllActiveRoutes: false,
  setShowAllActiveRoutes: (showAllActiveRoutes) => set({ showAllActiveRoutes }),

  isSharingLocation: true,
  setIsSharingLocation: (isSharing) => set({ isSharingLocation: isSharing }),

  currentLocation: null, // { lat, lng } live driver location
  setCurrentLocation: (location) => set({ currentLocation: location }),

  arrivalPrompt: null, // { jobId, jobName, stopId, stopOrder, address, distanceMeters }
  setArrivalPrompt: (arrivalPrompt) => set({ arrivalPrompt }),

  routeWeather: null, // { destinationWeather, hazards, highestSeverity }
  setRouteWeather: (routeWeather) => set({ routeWeather }),

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
    driverRoster: false,
    expenseLedger: false,
    fleetVehicles: false,
    dvir: false,
    fleetAnalytics: false,
    createJob: false,
    jobReport: false,
    logProgress: false,
    logExpense: false,
    podCapture: false,
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
