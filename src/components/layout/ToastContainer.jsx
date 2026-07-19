import React from 'react';
import { useToastStore } from '../../store/useToastStore';
import { XCircle, CheckCircle, Info, X } from 'lucide-react';

export default function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const removeToast = useToastStore((state) => state.removeToast);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        let Icon = Info;
        let bgColor = 'bg-gray-800';
        let iconColor = 'text-blue-400';

        if (toast.type === 'error') {
          Icon = XCircle;
          iconColor = 'text-red-400';
        } else if (toast.type === 'success') {
          Icon = CheckCircle;
          iconColor = 'text-green-400';
        }

        return (
          <div
            key={toast.id}
            className={`${bgColor} border border-gray-700 shadow-lg rounded-lg p-3 flex items-start gap-3 pointer-events-auto transform transition-all duration-300 w-80 max-w-full`}
          >
            <Icon className={`flex-shrink-0 ${iconColor}`} size={20} />
            <div className="flex-1 text-sm text-gray-200 mt-0.5">
              {toast.message}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-gray-400 hover:text-white flex-shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
