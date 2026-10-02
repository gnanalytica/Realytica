/**
 * Two kinds of storage on the phone.
 *
 * Secrets — the device token and who it belongs to — go to the keychain /
 * keystore through expo-secure-store. Everything else (the outbox, cached
 * screens, drafts) goes to AsyncStorage. On the web, which is only a
 * development target, there is no secure store, so secrets fall back to
 * AsyncStorage (localStorage) too.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const secureAvailable = Platform.OS !== 'web';

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  // Readable after the first unlock, so a sync that wakes while the phone is locked can still sign its requests.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export async function readSecret(key: string): Promise<string | null> {
  if (!secureAvailable) return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key, SECURE_OPTIONS);
}

export async function writeSecret(key: string, value: string): Promise<void> {
  if (!secureAvailable) return AsyncStorage.setItem(key, value);
  await SecureStore.setItemAsync(key, value, SECURE_OPTIONS);
}

export async function deleteSecret(key: string): Promise<void> {
  if (!secureAvailable) return AsyncStorage.removeItem(key);
  await SecureStore.deleteItemAsync(key, SECURE_OPTIONS);
}

export async function readJSON<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // A corrupt value is treated as absent rather than crashing the app on open.
    return null;
  }
}

export async function writeJSON(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function removeKey(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

export async function keysWithPrefix(prefix: string): Promise<string[]> {
  const all = await AsyncStorage.getAllKeys();
  return all.filter((k) => k.startsWith(prefix));
}

export { AsyncStorage };
