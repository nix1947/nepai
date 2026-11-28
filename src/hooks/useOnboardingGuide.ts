import { useCallback, useEffect, useState } from 'react';

const ONBOARDING_STORAGE_KEY = 'nepse_workbench_onboarding_v1';
const ONBOARDING_EVENT_NAME = 'nepse-onboarding-change';

const EXPLORATION_STORAGE_KEYS = [
  'nepse_watchlist_v1',
  'nepse_compare_v1',
  'nepse_watchlist_alerts_v1',
  'nepse_trading_settings_v1',
];

export type OnboardingStatus = 'pending' | 'completed' | 'skipped';

export interface OnboardingState {
  status: OnboardingStatus;
  visitedTabs: string[];
  completedSteps: number[];
  lastStep: number;
  updatedAt: string;
}

function hasExistingExplorationArtifacts(): boolean {
  try {
    for (const key of EXPLORATION_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      if (key === 'nepse_trading_settings_v1') {
        return true;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return true;
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return true;
    }
  } catch {
    // Ignore storage read issues
  }
  return false;
}

function defaultState(initialStatus: OnboardingStatus = 'pending'): OnboardingState {
  return {
    status: initialStatus,
    visitedTabs: ['today'],
    completedSteps: [],
    lastStep: 0,
    updatedAt: new Date().toISOString(),
  };
}

function readOnboardingState(): OnboardingState {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) {
      if (hasExistingExplorationArtifacts()) {
        const autoCompleted = defaultState('completed');
        localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(autoCompleted));
        return autoCompleted;
      }
      return defaultState('pending');
    }
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    const status: OnboardingStatus =
      parsed.status === 'completed' || parsed.status === 'skipped' ? parsed.status : 'pending';
    const visitedTabs = Array.isArray(parsed.visitedTabs)
      ? Array.from(new Set(parsed.visitedTabs.map((t) => String(t))))
      : ['today'];
    const completedSteps = Array.isArray(parsed.completedSteps)
      ? Array.from(new Set(parsed.completedSteps.filter((n) => typeof n === 'number')))
      : [];
    const lastStep = typeof parsed.lastStep === 'number' && parsed.lastStep >= 0 ? parsed.lastStep : 0;

    // If the user has already explored 4+ distinct tabs across sessions, treat as explored
    if (status === 'pending' && visitedTabs.length >= 4) {
      const autoExplored: OnboardingState = {
        status: 'completed',
        visitedTabs,
        completedSteps,
        lastStep,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(autoExplored));
      return autoExplored;
    }

    return {
      status,
      visitedTabs,
      completedSteps,
      lastStep,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return defaultState('pending');
  }
}

function writeOnboardingState(next: OnboardingState): void {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(ONBOARDING_EVENT_NAME));
  } catch {
    // Ignore storage quota errors
  }
}

export function useOnboardingGuide() {
  const [state, setState] = useState<OnboardingState>(() => readOnboardingState());
  const [guideOpen, setGuideOpen] = useState<boolean>(() => readOnboardingState().status === 'pending');
  const [pausedAtStep, setPausedAtStep] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setState(readOnboardingState());
    window.addEventListener('storage', sync);
    window.addEventListener(ONBOARDING_EVENT_NAME, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(ONBOARDING_EVENT_NAME, sync);
    };
  }, []);

  const persist = useCallback((updater: (prev: OnboardingState) => OnboardingState) => {
    const current = readOnboardingState();
    const next = updater(current);
    writeOnboardingState(next);
    setState(next);
  }, []);

  const markTabVisited = useCallback(
    (tabId: string) => {
      if (!tabId) return;
      persist((prev) => {
        if (prev.visitedTabs.includes(tabId)) return prev;
        const visitedTabs = [...prev.visitedTabs, tabId];
        // Once a user has explored 4+ tabs naturally, avoid popping up automatically again
        const nextStatus: OnboardingStatus =
          prev.status === 'pending' && visitedTabs.length >= 4 ? 'completed' : prev.status;
        return {
          ...prev,
          status: nextStatus,
          visitedTabs,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [persist]
  );

  const setCurrentStep = useCallback(
    (stepIndex: number) => {
      persist((prev) => {
        const completedSteps = prev.completedSteps.includes(stepIndex)
          ? prev.completedSteps
          : [...prev.completedSteps, stepIndex];
        return {
          ...prev,
          lastStep: stepIndex,
          completedSteps,
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [persist]
  );

  const completeGuide = useCallback(() => {
    persist((prev) => ({
      ...prev,
      status: 'completed',
      completedSteps: Array.from(new Set([...prev.completedSteps, 0, 1, 2, 3, 4, 5])),
      updatedAt: new Date().toISOString(),
    }));
    setPausedAtStep(null);
    setGuideOpen(false);
  }, [persist]);

  const skipGuide = useCallback(() => {
    persist((prev) => ({
      ...prev,
      status: 'skipped',
      updatedAt: new Date().toISOString(),
    }));
    setPausedAtStep(null);
    setGuideOpen(false);
  }, [persist]);

  const pauseAndTryInApp = useCallback(
    (stepIndex: number) => {
      persist((prev) => ({
        ...prev,
        lastStep: stepIndex,
        completedSteps: prev.completedSteps.includes(stepIndex)
          ? prev.completedSteps
          : [...prev.completedSteps, stepIndex],
        updatedAt: new Date().toISOString(),
      }));
      setPausedAtStep(stepIndex);
      setGuideOpen(false);
    },
    [persist]
  );

  const openGuide = useCallback((stepIndex?: number) => {
    if (typeof stepIndex === 'number') {
      persist((prev) => ({
        ...prev,
        lastStep: stepIndex,
        updatedAt: new Date().toISOString(),
      }));
    }
    setPausedAtStep(null);
    setGuideOpen(true);
  }, [persist]);

  const resumeGuide = useCallback(() => {
    setPausedAtStep(null);
    setGuideOpen(true);
  }, []);

  const dismissPausedBanner = useCallback(() => {
    setPausedAtStep(null);
    persist((prev) => ({
      ...prev,
      status: prev.status === 'pending' ? 'skipped' : prev.status,
      updatedAt: new Date().toISOString(),
    }));
  }, [persist]);

  return {
    onboardingState: state,
    guideOpen,
    pausedAtStep,
    isFirstTimePending: state.status === 'pending',
    markTabVisited,
    setCurrentStep,
    completeGuide,
    skipGuide,
    pauseAndTryInApp,
    openGuide,
    resumeGuide,
    dismissPausedBanner,
  };
}
