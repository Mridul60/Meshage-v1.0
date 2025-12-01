import React, { createContext, PropsWithChildren, useContext } from 'react';
import { useChatScreen } from '../screens/chat/useChatScreen';

export type NetworkingContextValue = ReturnType<typeof useChatScreen>;

const NetworkingContext = createContext<NetworkingContextValue | undefined>(undefined);

export const NetworkingProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const networkingValue = useChatScreen();

  return (
    <NetworkingContext.Provider value={networkingValue}>
      {children}
    </NetworkingContext.Provider>
  );
};

export const useNetworking = () => {
  const value = useContext(NetworkingContext);
  if (!value) {
    throw new Error('useNetworking must be used within a NetworkingProvider');
  }
  return value;
};
