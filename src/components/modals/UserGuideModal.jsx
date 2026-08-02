import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import ReactMarkdown from 'react-markdown';
import userGuideMd from '../../../user_guide.md?raw';

export default function UserGuideModal() {
  const { modals, closeModal } = useAppStore();

  if (!modals.userGuide) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => closeModal('userGuide')}>
      <div 
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl border border-gray-700 p-6 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="overflow-y-auto text-gray-300 space-y-4 prose prose-invert prose-sm md:prose-base max-w-none">
          <ReactMarkdown>{userGuideMd}</ReactMarkdown>
        </div>
        <div className="mt-6 pt-4 border-t border-gray-700 flex justify-end shrink-0">
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
