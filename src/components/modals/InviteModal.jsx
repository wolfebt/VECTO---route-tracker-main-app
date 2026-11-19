import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useAppStore } from '../../store/useAppStore';
import { useToastStore } from '../../store/useToastStore';
import { useJobs } from '../../hooks/useFirebase';
import { Copy, Download, QrCode, Building, Briefcase, Check, Radio, MessageSquare, ShieldOff } from 'lucide-react';
import { db } from '../../firebase';
import { getPublicAppBaseUrl } from '../../utils/formatters';
import { buildCustomerTrackingUrl, ensurePublicTrackingLink, revokePublicTrackingLink } from '../../utils/publicTracking';

export default function InviteModal() {
  const { modals, closeModal, companyId, companyName, selectedJobId, currentUser, currentLocation, routeInfo } = useAppStore();
  const addToast = useToastStore((state) => state.addToast);
  const jobs = useJobs();

  // Tab state: 'company', 'job', or 'customer'
  const [activeTab, setActiveTab] = useState('company');
  const [targetJobId, setTargetJobId] = useState('');
  const [copiedType, setCopiedType] = useState(null);
  const [customerTrackingUrl, setCustomerTrackingUrl] = useState('');
  const [generatingLink, setGeneratingLink] = useState(false);

  const modalPayload = typeof modals.invite === 'object' ? modals.invite : null;

  useEffect(() => {
    if (modals.invite) {
      if (modalPayload?.tab === 'customer') {
        setActiveTab('customer');
      } else if (modalPayload?.jobId) {
        setActiveTab('job');
      }

      if (modalPayload?.jobId) {
        setTargetJobId(modalPayload.jobId);
      } else if (selectedJobId) {
        setTargetJobId(selectedJobId);
      } else if (jobs.length > 0) {
        setTargetJobId(prev => prev || jobs[0].id);
      }
    }
  }, [modals.invite, modalPayload, selectedJobId, jobs]);

  const selectedTrackJob = jobs.find(j => j.id === targetJobId);
  useEffect(() => {
    if (selectedTrackJob?.trackingToken) {
      setCustomerTrackingUrl(buildCustomerTrackingUrl(selectedTrackJob.trackingToken));
    } else {
      setCustomerTrackingUrl('');
    }
  }, [selectedTrackJob?.id, selectedTrackJob?.trackingToken]);

  if (!modals.invite) return null;

  const appUrl = getPublicAppBaseUrl();
  const companyQrUrl = `${appUrl}?company=${companyId || ''}`;
  
  const currentJob = jobs.find(j => j.id === targetJobId);
  const jobQrUrl = targetJobId ? `${appUrl}?company=${companyId || ''}&job=${targetJobId}` : companyQrUrl;

  const activeQrUrl =
    activeTab === 'company'
      ? companyQrUrl
      : activeTab === 'customer'
      ? (customerTrackingUrl || jobQrUrl)
      : jobQrUrl;

  const handleGenerateCustomerLink = async () => {
    if (!currentJob || !companyId) return;
    setGeneratingLink(true);
    try {
      const res = await ensurePublicTrackingLink({
        db,
        companyId,
        companyName,
        job: currentJob,
        driverId: currentUser?.id,
        driverName: currentUser?.name || currentUser?.email,
        driverLocation: currentLocation,
        routeInfo
      });
      setCustomerTrackingUrl(res.url);
      addToast("Customer live tracking link ready!", "success");
    } catch (err) {
      console.error("Failed to generate tracking link:", err);
      addToast("Could not generate customer tracking link.", "error");
    }
    setGeneratingLink(false);
  };

  const handleRevokeCustomerLink = async () => {
    if (!currentJob || !companyId) return;
    if (!window.confirm("Revoke this customer tracking link? Existing link holders will no longer see live updates.")) return;
    try {
      await revokePublicTrackingLink({ db, companyId, job: currentJob });
      setCustomerTrackingUrl('');
      addToast("Customer tracking link revoked.", "info");
    } catch (err) {
      console.error("Failed to revoke tracking link:", err);
      addToast("Could not revoke link.", "error");
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    addToast(type === 'app' ? "App link copied!" : type === 'company' ? "Company QR link copied!" : "Job QR link copied!", "success");
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleDownloadQr = () => {
    const svgElement = document.getElementById('invite-qr-code');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width + 40;
      canvas.height = img.height + 40;
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 20, 20);
      }
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = `${activeTab === 'company' ? (companyName || 'company') : (currentJob?.jobName || 'job')}-qr.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => closeModal('invite')}>
      <div 
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex justify-between items-center bg-slate-900/60">
          <div className="flex items-center space-x-2">
            <QrCode className="text-primary-400" size={22} />
            <h3 className="text-lg font-bold text-white">Invite & Driver Onboarding</h3>
          </div>
          <button 
            onClick={() => closeModal('invite')} 
            className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors text-xl font-bold"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-white/10 bg-slate-950/40">
          <button 
            onClick={() => setActiveTab('company')}
            className={`flex-1 py-3 px-2 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all ${activeTab === 'company' ? 'text-primary-400 border-b-2 border-primary-500 bg-white/5' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <Building size={14} />
            <span>Company QR</span>
          </button>
          <button 
            onClick={() => setActiveTab('job')}
            className={`flex-1 py-3 px-2 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all ${activeTab === 'job' ? 'text-accent-400 border-b-2 border-accent-500 bg-white/5' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <Briefcase size={14} />
            <span>Job QR</span>
          </button>
          <button 
            onClick={() => setActiveTab('customer')}
            className={`flex-1 py-3 px-2 text-[11px] font-bold uppercase tracking-wider flex items-center justify-center space-x-1.5 transition-all ${activeTab === 'customer' ? 'text-emerald-400 border-b-2 border-emerald-500 bg-white/5' : 'text-gray-400 hover:text-gray-200'}`}
          >
            <Radio size={14} />
            <span>Customer Track</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Job Selection Dropdown if Job QR or Customer Track Tab Active */}
          {(activeTab === 'job' || activeTab === 'customer') && (
            <div>
              <label className="block text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2">Select Target Job</label>
              {jobs.length === 0 ? (
                <p className="text-xs text-yellow-400 italic">No active jobs in company. Create a job first.</p>
              ) : (
                <select 
                  value={targetJobId} 
                  onChange={(e) => setTargetJobId(e.target.value)}
                  className="w-full bg-slate-800 text-white rounded-xl p-3 border border-white/10 focus:ring-2 focus:ring-accent-500 outline-none text-sm font-medium"
                >
                  {jobs.map(j => (
                    <option key={j.id} value={j.id}>
                      {j.jobName || 'Unnamed Job'} ({j.status || 'Available'})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {activeTab === 'customer' ? (
            <div className="space-y-4">
              {!currentJob ? (
                <p className="text-xs text-slate-400 text-center py-6">Select a job above to manage its customer tracking link.</p>
              ) : !customerTrackingUrl ? (
                <div className="p-5 bg-slate-800/50 border border-slate-700/80 rounded-2xl text-center space-y-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
                    <Radio size={22} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Read-Only Customer Tracking</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Share a secure live map & ETA link for <strong className="text-slate-200">{currentJob.jobName}</strong> without exposing company internals or customer phone numbers.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleGenerateCustomerLink}
                    disabled={generatingLink}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-50"
                  >
                    {generatingLink ? 'Creating Tracking Link...' : 'Generate Customer Tracking Link'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="p-4 bg-white rounded-2xl shadow-xl flex items-center justify-center border border-emerald-400/40">
                      <QRCodeSVG 
                        id="invite-qr-code"
                        value={customerTrackingUrl} 
                        size={170} 
                        level="H" 
                        includeMargin={false}
                      />
                    </div>
                    <p className="text-xs font-medium text-gray-300 mt-3 max-w-xs">
                      Customers see live delivery pin, ETA, stop progress & POD verification only.
                    </p>
                    <button 
                      onClick={handleDownloadQr}
                      className="mt-2.5 text-xs text-gray-400 hover:text-white flex items-center space-x-1.5 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
                    >
                      <Download size={14} />
                      <span>Save Tracking QR</span>
                    </button>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-white/10">
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider block">
                      Live Customer Tracking URL
                    </span>
                    <div className="flex space-x-2">
                      <input 
                        type="text" 
                        readOnly 
                        value={customerTrackingUrl}
                        className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-xl text-gray-200 text-xs outline-none select-all font-mono"
                      />
                      <button 
                        onClick={() => copyToClipboard(customerTrackingUrl, 'customer')}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center space-x-1.5 shrink-0"
                      >
                        {copiedType === 'customer' ? <Check size={14} /> : <Copy size={14} />}
                        <span>{copiedType === 'customer' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      {currentJob.contactNumber && (
                        <a
                          href={`sms:${currentJob.contactNumber}?body=${encodeURIComponent(`Track your VECTO delivery live: ${customerTrackingUrl}`)}`}
                          className="flex-1 py-2 px-3 bg-sky-600/20 hover:bg-sky-600/35 text-sky-300 border border-sky-500/40 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <MessageSquare size={14} />
                          <span>Text to Customer</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={handleRevokeCustomerLink}
                        className="flex-1 py-2 px-3 bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 border border-rose-500/40 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <ShieldOff size={14} />
                        <span>Revoke Link</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center text-center">
                <div className="p-4 bg-white rounded-2xl shadow-xl flex items-center justify-center border border-white/20 relative group">
                  <QRCodeSVG 
                    id="invite-qr-code"
                    value={activeQrUrl} 
                    size={180} 
                    level="H" 
                    includeMargin={false}
                  />
                </div>
                
                <p className="text-xs font-medium text-gray-300 mt-3 max-w-xs">
                  {activeTab === 'company' ? (
                    <>Scan to join <strong className="text-primary-400">{companyName || 'Active Company'}</strong> and add driver to company list.</>
                  ) : (
                    <>Scan for instant onboarding to <strong className="text-accent-400">{currentJob?.jobName || 'Job'}</strong> & company drivers list.</>
                  )}
                </p>

                <button 
                  onClick={handleDownloadQr}
                  className="mt-3 text-xs text-gray-400 hover:text-white flex items-center space-x-1.5 bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/10 transition-colors"
                >
                  <Download size={14} />
                  <span>Save QR Code Image</span>
                </button>
              </div>

              {/* App URL Share Link */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">App Link (General)</span>
                    <span className="text-[10px] text-gray-500">Points to main application</span>
                  </div>
                  <div className="flex space-x-2">
                    <input 
                      type="text" 
                      readOnly 
                      value={appUrl}
                      className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-xl text-gray-200 text-xs outline-none select-all"
                    />
                    <button 
                      onClick={() => copyToClipboard(appUrl, 'app')}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center space-x-1.5 flex-shrink-0"
                    >
                      {copiedType === 'app' ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedType === 'app' ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* Direct Onboarding Link */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      {activeTab === 'company' ? 'Company Join Link' : 'Job Onboard Link'}
                    </span>
                    <span className="text-[10px] text-gray-500">Encodes company & driver setup</span>
                  </div>
                  <div className="flex space-x-2">
                    <input 
                      type="text" 
                      readOnly 
                      value={activeQrUrl}
                      className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-xl text-gray-200 text-xs outline-none select-all font-mono"
                    />
                    <button 
                      onClick={() => copyToClipboard(activeQrUrl, activeTab)}
                      className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center space-x-1.5 flex-shrink-0"
                    >
                      {copiedType === activeTab ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copiedType === activeTab ? 'Copied' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950/60 border-t border-white/10 flex justify-end">
          <button 
            onClick={() => closeModal('invite')}
            className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-sm transition-colors border border-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
