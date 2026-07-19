import React from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function UserGuideModal() {
  const { modals, closeModal } = useAppStore();

  if (!modals.userGuide) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => closeModal('userGuide')}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl border border-gray-700 p-6 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-2xl font-bold text-white mb-4">Vecto User Guide</h3>
        <div className="overflow-y-auto text-gray-300 space-y-4">
          <p>Welcome to Vecto! Use the map to track your fleet and the sidebar to manage jobs.</p>
          <p><strong>Dispatchers:</strong> Create jobs, track drivers, and manage users.</p>
          <p><strong>Drivers:</strong> Accept jobs, navigate, and mark deliveries as complete.</p>
        </div>
        <div className="mt-6 pt-4 border-t border-gray-700 flex justify-end">
          <button 
            onClick={() => closeModal('userGuide')}
            className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
