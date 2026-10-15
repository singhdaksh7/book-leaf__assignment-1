import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { CurrentUser, LoginRequest } from "@bookleaf/contracts";
import { getApiClient, type ApiClient, ApiClientError } from "../api";
import { ticketEventManager } from "../api/events";

interface AuthContextType {
  user: CurrentUser | null;
  isLoading: boolean;
  error: string | null;
  client: ApiClient;
  login: (credentials: LoginRequest) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  isMockMode: boolean;
  setIsMockMode: (useMock: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode; initialClient?: ApiClient }> = ({
  children,
  initialClient,
}) => {
  const [client, setClient] = useState<ApiClient>(() => initialClient || getApiClient());

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await client.getCurrentUser();
      setUser(res.user);
    } catch (err) {
      setUser(null);
      ticketEventManager.close();
      if (err instanceof ApiClientError && err.status === 401) {
        // Not logged in, normal state
      } else {
        console.warn("Session check returned error:", err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (credentials: LoginRequest): Promise<CurrentUser> => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await client.login(credentials);
      setUser(res.user);
      ticketEventManager.init();
      return res.user;
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Failed to log in. Please check your credentials.";
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await client.logout();
    } catch (err) {
      console.warn("Logout error:", err);
    } finally {
      ticketEventManager.close();
      setUser(null);
      setIsLoading(false);
    }
  };

  const setIsMockMode = (useMock: boolean) => {
    const newClient = useMock ? new (getApiClient().constructor as any)() : getApiClient();
    setClient(newClient);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        client,
        login,
        logout,
        refreshUser,
        isMockMode: client.isMock,
        setIsMockMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
