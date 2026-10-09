import { Redirect, useLocalSearchParams } from 'expo-router';

// Ancienne adresse de l'écran de saisie du code : identité et code partagent désormais l'écran d'identification.
export default function Verify() { return <Redirect href={{ pathname: '/identify', params: useLocalSearchParams() }} />; }
