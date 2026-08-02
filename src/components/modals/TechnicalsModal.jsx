import React from 'react';
import { useAppStore } from '../../store/useAppStore';
import ReactMarkdown from 'react-markdown';
import onboardingGuideMd from '../../../onboarding_guide.md?raw';

export default function TechnicalsModal() {
  const { modals, closeModal } = useAppStore();

  if (!modals.technicals) return null;

  return (
    <div className="fixed inset-0 bg-[#0b0f19]/80 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={() => closeModal('technicals')}>
      <div 
        className="bg-slate-900 rounded-2xl shadow-xl w-full max-w-4xl border border-white/10 p-6 flex flex-col max-h-[90vh] relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-primary-500 to-transparent opacity-50"></div>
        <div className="overflow-y-auto text-gray-300 space-y-4 prose prose-invert prose-sm md:prose-base max-w-none">
          <ReactMarkdown>{onboardingGuideMd}</ReactMarkdown>
        </div>
        <div className="mt-6 pt-4 border-t border-white/10 flex justify-end shrink-0">
          <button 
            onClick={() => closeModal('technicals')}
            className="btn-secondary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
