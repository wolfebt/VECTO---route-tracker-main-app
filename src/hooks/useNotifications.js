import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { getApp } from 'firebase/app';
import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { db } from '../firebase';
import { useAppStore } from '../store/useAppStore';
import { useToastStore } from '../store/useToastStore';

function toMillisSafe(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'number') return ts;
  return 0;
}

function getVisibleInstructionKeys(job, userId) {
  const keys = new Set();
  if (!Array.isArray(job?.instructions)) return keys;
  job.instructions.forEach((inst, idx) => {
    if (!inst || (!inst.text && !inst.id)) return;
    if (!inst.target || inst.target === 'all' || inst.target === userId) {
      keys.add(inst.id || `${idx}:${inst.text || ''}`);
    }
  });
  return keys;
}

async function showBrowserNotification(title, body, jobId) {
  if (Capacitor.isNativePlatform()) return;
  if (typeof document === 'undefined' || !document.hidden) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const baseUrl = window.location.href;
  const tag = jobId ? `vecto-job-${jobId}` : 'vecto-dispatch';

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          icon: './favicon.svg',
          badge: './favicon.svg',
          tag,
          data: { jobId: jobId || '', url: baseUrl }
        });
        return;
      }
    }

    const notification = new Notification(title, {
      body,
      icon: './favicon.svg',
      tag
    });
    notification.onclick = () => {
      window.focus();
      if (jobId) {
        const store = useAppStore.getState();
        store.setSelectedJobId(jobId);
        store.setMainView('map');
        store.setMobileView('map');
      }
    };
  } catch (err) {
    console.warn('Browser notification error:', err);
  }
}

export async function enableNotifications(userId) {
  if (Capacitor.isNativePlatform()) {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      return { granted: false, status: perm.receive, platform: 'native' };
    }

    await PushNotifications.register();
    if (userId) {
      await updateDoc(doc(db, 'users', userId), {
        'preferences.notificationsEnabled': true,
        updatedAt: serverTimestamp()
      });
    }
    return { granted: true, status: 'granted', platform: 'native' };
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { granted: false, status: 'unsupported', platform: 'web' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { granted: false, status: permission, platform: 'web' };
  }

  let swReg = null;
  if ('serviceWorker' in navigator) {
    try {
      swReg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    } catch (err) {
      console.warn('Service worker registration failed:', err);
    }
  }

  let token = '';
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
  if (vapidKey) {
    try {
      if (await isSupported()) {
        const messaging = getMessaging(getApp());
        token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: swReg || undefined
        });
      }
    } catch (err) {
      console.warn('FCM web token retrieval skipped:', err);
    }
  }

  if (userId) {
    const updates = {
      'preferences.notificationsEnabled': true,
      updatedAt: serverTimestamp()
    };
    if (token) {
      updates.fcmToken = token;
      updates.fcmTokens = arrayUnion(token);
    }
    await updateDoc(doc(db, 'users', userId), updates);
  }

  return {
    granted: true,
    status: permission,
    platform: 'web',
    hasFcmToken: Boolean(token)
  };
}

export function useNotifications(jobs = []) {
  const currentUser = useAppStore((s) => s.currentUser);
  const companyId = useAppStore((s) => s.companyId);
  const isDispatchView = useAppStore((s) => s.isDispatchView);
  const selectedJobId = useAppStore((s) => s.selectedJobId);
  const setSelectedJobId = useAppStore((s) => s.setSelectedJobId);
  const setMainView = useAppStore((s) => s.setMainView);
  const setMobileView = useAppStore((s) => s.setMobileView);
  const addToast = useToastStore((s) => s.addToast);

  const currentUserRef = useRef(currentUser);
  const prevJobsRef = useRef(new Map());
  const seededCompanyRef = useRef(null);

  currentUserRef.current = currentUser;

  // 1. Native Android/iOS Push Notifications setup & deep-linking
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!currentUser?.id) return;

    let isDisposed = false;
    const handles = [];

    const registerNativePush = async () => {
      try {
        let perm = await PushNotifications.checkPermissions();
        const alreadyPrompted = (() => {
          try {
            return localStorage.getItem('vecto_native_push_prompted') === '1';
          } catch {
            return false;
          }
        })();

        if (
          (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') &&
          !alreadyPrompted &&
          currentUser.preferences?.notificationsEnabled !== false
        ) {
          try {
            localStorage.setItem('vecto_native_push_prompted', '1');
          } catch {
            // ignore storage errors
          }
          perm = await PushNotifications.requestPermissions();
        }

        if (perm.receive === 'granted' && !isDisposed) {
          await PushNotifications.register();
        }
      } catch (err) {
        console.warn('Native push initialization warning:', err);
      }
    };

    const attach = async () => {
      const regHandle = await PushNotifications.addListener('registration', async (token) => {
        if (isDisposed || !token?.value) return;
        try {
          await updateDoc(doc(db, 'users', currentUser.id), {
            fcmToken: token.value,
            fcmTokens: arrayUnion(token.value),
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          console.warn('Failed to persist FCM token:', err);
        }
      });

      const errHandle = await PushNotifications.addListener('registrationError', (err) => {
        console.warn('Push registration error:', err);
      });

      const recvHandle = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        if (isDisposed) return;
        const title = notification?.title || 'Vecto Dispatch';
        const body = notification?.body || '';
        addToast(body ? `${title}: ${body}` : title, 'info');
      });

      const actionHandle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        if (isDisposed) return;
        const jobId = action?.notification?.data?.jobId;
        if (jobId) {
          setSelectedJobId(jobId);
          setMainView('map');
          setMobileView('map');
        }
      });

      if (isDisposed) {
        regHandle?.remove();
        errHandle?.remove();
        recvHandle?.remove();
        actionHandle?.remove();
      } else {
        handles.push(regHandle, errHandle, recvHandle, actionHandle);
      }
    };

    attach();
    registerNativePush();

    return () => {
      isDisposed = true;
      handles.forEach((h) => h?.remove());
    };
  }, [currentUser?.id, currentUser?.preferences?.notificationsEnabled, addToast, setSelectedJobId, setMainView, setMobileView]);

  // 2. Web Service Worker click message listener (focuses matching job)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSwMessage = (event) => {
      if (event.data?.type === 'VECTO_NOTIFICATION_CLICK' && event.data?.jobId) {
        setSelectedJobId(event.data.jobId);
        setMainView('map');
        setMobileView('map');
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [setSelectedJobId, setMainView, setMobileView]);

  // 3. Reset snapshot baseline whenever workspace changes + fallback timer for 0-job fleets
  useEffect(() => {
    prevJobsRef.current = new Map();
    seededCompanyRef.current = null;
    if (!companyId) return;

    const timer = setTimeout(() => {
      if (seededCompanyRef.current !== companyId) {
        seededCompanyRef.current = companyId;
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [companyId]);

  // 4. Real-time Firestore job diff detector -> Toasts & Web Notifications
  useEffect(() => {
    const userId = currentUser?.id;
    if (!companyId || !userId || !Array.isArray(jobs)) return;

    const buildSnapshot = (job) => ({
      assignedIds: new Set((job.assignedDrivers || []).map((d) => d.id)),
      status: job.status || 'unassigned',
      instructionKeys: getVisibleInstructionKeys(job, userId),
      lastMsgMs: toMillisSafe(job.lastMessageTimestamp)
    });

    if (seededCompanyRef.current !== companyId) {
      if (jobs.length === 0) return;
      const seed = new Map();
      jobs.forEach((job) => seed.set(job.id, buildSnapshot(job)));
      prevJobsRef.current = seed;
      seededCompanyRef.current = companyId;
      return;
    }

    const prevMap = prevJobsRef.current;
    const nextMap = new Map();
    const notificationsAllowed = currentUserRef.current?.preferences?.notificationsEnabled !== false;
    const lastReadMap = currentUserRef.current?.lastRead || {};

    const emitAlert = (title, body, jobId, variant = 'info') => {
      addToast(`${title}: ${body}`, variant);
      if (notificationsAllowed) {
        showBrowserNotification(title, body, jobId);
      }
    };

    for (const job of jobs) {
      const snap = buildSnapshot(job);
      nextMap.set(job.id, snap);

      if (job.archived || job.status === 'cancelled') continue;

      const prev = prevMap.get(job.id);
      const isAssignedToMe = snap.assignedIds.has(userId);
      const jobLabel = job.jobName || 'Unnamed Job';

      // A. New assignment to the current driver
      if (isAssignedToMe && (!prev || !prev.assignedIds.has(userId)) && job.status !== 'completed') {
        emitAlert('New Job Assigned', jobLabel, job.id, 'info');
        continue;
      }

      // B. Dispatcher review alert for pending completion
      if (isDispatchView && job.status === 'pending-completion' && prev && prev.status !== 'pending-completion') {
        emitAlert('Job Pending Review', `${jobLabel} awaiting dispatch verification`, job.id, 'info');
      }

      if (!prev) continue;

      // C. Newly added priority dispatch instruction
      if ((isAssignedToMe || isDispatchView) && Array.isArray(job.instructions)) {
        const hasNewPriority = job.instructions.some((inst, idx) => {
          if (!inst?.isPriority) return false;
          if (inst.target && inst.target !== 'all' && inst.target !== userId) return false;
          const key = inst.id || `${idx}:${inst.text || ''}`;
          return !prev.instructionKeys.has(key);
        });
        if (hasNewPriority) {
          emitAlert('Priority Dispatch Note', jobLabel, job.id, 'warning');
        }
      }

      // D. New unread chat message on an assigned job not currently open
      if (isAssignedToMe && selectedJobId !== job.id) {
        const lastReadMs = toMillisSafe(lastReadMap[job.id]);
        if (snap.lastMsgMs > prev.lastMsgMs && snap.lastMsgMs > lastReadMs) {
          emitAlert('New Job Message', jobLabel, job.id, 'info');
        }
      }
    }

    prevJobsRef.current = nextMap;
  }, [jobs, companyId, currentUser?.id, isDispatchView, selectedJobId, addToast]);
}
