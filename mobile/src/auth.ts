import * as SecureStore from "expo-secure-store";

// Tokens go in the OS keychain/keystore, never AsyncStorage.
// TODO: on 401, call /auth/refresh with the stored refresh token and retry once.
export const getAccessToken = () => SecureStore.getItemAsync("access");
export const setTokens = async (a: string, r: string) => { await SecureStore.setItemAsync("access", a); await SecureStore.setItemAsync("refresh", r); };
