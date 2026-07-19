import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';

export default function InviteModal() {
  const { modals, closeModal } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);

  if (!modals.invite) return null;

  const shareLink = window.location.origin;

  const copyLink = () => {
    navigator.clipboard.writeText(shareLink);
    addToast("Link copied!", "success");
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => closeModal('invite')}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-gray-700 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold text-white mb-6">Invite Others</h3>
        <div className="space-y-6">
          <div className="text-center">
            <p className="text-gray-400 mb-2">Scan QR Code</p>
            <div className="flex justify-center p-2 bg-white rounded-lg w-32 h-32 mx-auto flex items-center justify-center text-gray-500 text-sm border">
              [QR Placeholder]
            </div>
          </div>
          <div>
            <p className="text-gray-400 mb-2">Or share this link:</p>
            <div className="flex space-x-2">
              <input 
                type="text" 
                readOnly 
                value={shareLink}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white outline-none"
              />
              <button 
                onClick={copyLink}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
        <button 
          onClick={() => closeModal('invite')}
          className="mt-8 w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
