import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

interface ProfilePhotoContextType {
  tabPhotoUri: string | null;
  setProfilePhoto: (uri: string | null) => void;
}

const ProfilePhotoContext = createContext<ProfilePhotoContextType>({
  tabPhotoUri: null,
  setProfilePhoto: () => {},
});

export function ProfilePhotoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [tabPhotoUri, setTabPhotoUri] = useState<string | null>(null);

  // Load from AsyncStorage whenever the signed-in user changes.
  useEffect(() => {
    if (!user) {
      if (__DEV__) console.log('[TabBar] user signed out — clearing tab avatar');
      setTabPhotoUri(null);
      return;
    }
    const key = `profilePhoto:${user.id}`;
    if (__DEV__) console.log('[TabBar] loading tab avatar for user:', user.id);
    AsyncStorage.getItem(key).then(cached => {
      if (cached && !cached.startsWith('file://')) {
        if (__DEV__) console.log('[TabBar] tab avatar loaded from cache:', cached);
        setTabPhotoUri(cached);
      } else {
        if (__DEV__) console.log('[TabBar] no cached avatar — showing placeholder icon');
        setTabPhotoUri(null);
      }
    }).catch(() => setTabPhotoUri(null));
  }, [user?.id]);

  function setProfilePhoto(uri: string | null) {
    if (__DEV__) console.log('[TabBar] setProfilePhoto called → uri:', uri, '| rendered:', uri ? 'AVATAR' : 'PLACEHOLDER');
    setTabPhotoUri(uri);
  }

  return (
    <ProfilePhotoContext.Provider value={{ tabPhotoUri, setProfilePhoto }}>
      {children}
    </ProfilePhotoContext.Provider>
  );
}

export const useProfilePhoto = () => useContext(ProfilePhotoContext);
