import React, { useState, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs } from '../../hooks/useFirebase';
import { db, storage } from '../../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { FileText, X, Camera, Paperclip, Trash2, CheckCircle2 } from 'lucide-react';

export default function LogExpenseModal() {
  const { modals, closeModal, companyId, currentUser } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();

  const [expenseType, setExpenseType] = useState('fuel');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const fileInputRef = useRef(null);

  const modalData = modals.logExpense;
  const jobId = typeof modalData === 'object' ? modalData?.jobId : null;
  const job = jobs.find(j => j.id === jobId);

  if (!modals.logExpense) return null;

  const handleClose = () => {
    setExpenseType('fuel');
    setAmount('');
    setDescription('');
    setReceiptFile(null);
    if (receiptPreview) {
      URL.revokeObjectURL(receiptPreview);
      setReceiptPreview(null);
    }
    closeModal('logExpense');
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      addToast("Receipt file must be under 10MB", "error");
      return;
    }

    setReceiptFile(file);
    if (file.type.startsWith('image/')) {
      const previewUrl = URL.createObjectURL(file);
      setReceiptPreview(previewUrl);
    } else {
      setReceiptPreview(null);
    }
  };

  const handleRemoveReceipt = () => {
    setReceiptFile(null);
    if (receiptPreview) {
      URL.revokeObjectURL(receiptPreview);
      setReceiptPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSaveExpense = async (e) => {
    e.preventDefault();
    if (!amount.trim() || !jobId || !companyId || !currentUser?.id) return;
    setSavingExpense(true);
    try {
      let receiptUrl = null;

      if (receiptFile) {
        const fileExt = receiptFile.name.split('.').pop() || 'jpg';
        const storagePath = `receipts/${companyId}/${jobId}/${Date.now()}_${currentUser.id}.${fileExt}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, receiptFile);
        receiptUrl = await getDownloadURL(storageRef);
      }

      await addDoc(collection(db, `companies/${companyId}/jobs/${jobId}/expenses`), {
        type: expenseType,
        amount: parseFloat(amount),
        description: description.trim(),
        receiptUrl: receiptUrl || null,
        driverId: currentUser.id,
        driverName: currentUser.name || currentUser.email || 'Unknown',
        status: 'submitted', // submitted | approved | rejected | reimbursed
        timestamp: serverTimestamp()
      });

      addToast("Expense & receipt logged successfully", "success");
      handleClose();
    } catch (error) {
      console.error(error);
      addToast("Failed to log expense", "error");
    }
    setSavingExpense(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-slate-900 border border-slate-800 text-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-orange-500/20 text-orange-400 rounded-xl border border-orange-500/30">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Log Driver Expense</h2>
              <p className="text-xs text-slate-400 font-medium truncate max-w-[280px]">
                {job?.jobName ? `Job: ${job.jobName}` : 'Add trip expense & receipt'}
              </p>
            </div>
          </div>
          <button 
            onClick={handleClose} 
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveExpense} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Expense Category */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Expense Category
            </label>
            <select
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
            >
              <option value="fuel">⛽ Fuel / Gas</option>
              <option value="food">🍔 Food & Meals</option>
              <option value="toll">🛣️ Toll / Parking</option>
              <option value="maintenance">🔧 Maintenance / Repairs</option>
              <option value="lodging">🏨 Lodging / Hotel</option>
              <option value="custom">📝 Other / Custom</option>
            </select>
          </div>

          {/* Amount ($) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Amount ($) *
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none placeholder:text-slate-500 font-mono text-base"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Description / Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="E.g., 25 Gallons Diesel at Pilot #402, exit 12..."
              className="w-full bg-slate-800/80 border border-slate-700 text-white rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none placeholder:text-slate-500"
            />
          </div>

          {/* Receipt Photo / Attachment */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Receipt Photo / Attachment
            </label>

            {receiptFile ? (
              <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center space-x-3 overflow-hidden">
                  {receiptPreview ? (
                    <img 
                      src={receiptPreview} 
                      alt="Receipt preview" 
                      className="w-12 h-12 rounded-lg object-cover border border-slate-600 shrink-0" 
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                      <Paperclip size={20} />
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold text-white truncate">{receiptFile.name}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {(receiptFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveReceipt}
                  className="p-2 text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition-colors shrink-0"
                  title="Remove receipt"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-orange-500/50 rounded-xl p-4 flex flex-col items-center justify-center gap-1.5 cursor-pointer bg-slate-800/30 hover:bg-slate-800/50 transition-all text-center"
              >
                <div className="flex items-center space-x-2 text-orange-400">
                  <Camera size={20} />
                  <Paperclip size={18} />
                </div>
                <p className="text-xs font-semibold text-slate-200">
                  Tap to take photo or upload receipt
                </p>
                <p className="text-[10px] text-slate-500">
                  PNG, JPG, WebP, or PDF up to 10MB
                </p>
              </div>
            )}

            <input 
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingExpense || !amount.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 text-white rounded-xl text-xs font-bold shadow-lg transition-all disabled:opacity-50 min-h-[44px] flex items-center space-x-1.5"
            >
              {savingExpense ? (
                <span>Uploading...</span>
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>Submit Expense</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
