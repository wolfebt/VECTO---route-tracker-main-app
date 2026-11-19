import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useAppStore } from '../../src/store/useAppStore';
import { useToastStore } from '../../src/store/useToastStore';

const INITIAL_APP_DATA = Object.fromEntries(
  Object.entries(useAppStore.getState())
    .filter(([, value]) => typeof value !== 'function')
    .map(([key, value]) => {
      if (Array.isArray(value)) return [key, [...value]];
      if (value && typeof value === 'object') return [key, { ...value }];
      return [key, value];
    })
);

export function resetAppAndToastStores() {
  useAppStore.setState({
    ...INITIAL_APP_DATA,
    memberPermissions: { ...INITIAL_APP_DATA.memberPermissions },
    jobs: [],
    activeJobs: [],
    archivedJobs: [],
    members: [],
    activeDrivers: [],
    vehicles: [],
    inspections: [],
    modals: { ...INITIAL_APP_DATA.modals },
    colors: [...INITIAL_APP_DATA.colors],
  });
  useToastStore.setState({ toasts: [] });
  if (typeof localStorage !== 'undefined') localStorage.clear();
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
}

export async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function renderWithAct(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(ui);
  });

  return {
    container,
    async rerender(nextUi) {
      await act(async () => {
        root.render(nextUi);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

export async function renderHookWithAct(useHookFn, initialProps) {
  const result = { current: undefined };
  function Probe({ hookProps }) {
    result.current = useHookFn(hookProps);
    return null;
  }

  const rendered = await renderWithAct(<Probe hookProps={initialProps} />);
  return {
    result,
    async rerender(nextProps) {
      await rendered.rerender(<Probe hookProps={nextProps} />);
    },
    async unmount() {
      await rendered.unmount();
    },
  };
}

export async function click(el) {
  await act(async () => {
    el.click();
  });
}

export async function changeValue(el, value) {
  await act(async () => {
    const tag = el.tagName;
    if (tag === 'INPUT' && el.type === 'checkbox') {
      if (el.checked !== Boolean(value)) {
        el.click();
      }
      return;
    }

    const proto =
      tag === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : tag === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;

    const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(el, String(value));
    } else {
      el.value = String(value);
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export async function submitForm(formEl) {
  await act(async () => {
    formEl.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
