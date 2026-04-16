'use client';

import { createContext, useContext } from 'react';

interface SystemNodeContextValue {
  node: string;
  setNode: (n: string) => void;
}

export const SystemNodeContext = createContext<SystemNodeContextValue>({
  node: '',
  setNode: () => {},
});

export function useSystemNode() {
  return useContext(SystemNodeContext);
}
