import { ActivityIndicator } from 'react-native';
import { Redirect, Slot } from 'expo-router';
import { useSession } from '../../lib/session';
export default function StaffLayout() { const {ready, token} = useSession(); if (!ready) return <ActivityIndicator/>; if (!token) return <Redirect href="/login"/>; return <Slot/>; }
