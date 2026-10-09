import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CandidateSessionProvider } from '../lib/candidate-session';
import { SessionProvider } from '../lib/session';
import { colors } from '../components/ui';
export default function Layout() { return <SessionProvider><CandidateSessionProvider><StatusBar style="dark"/><Stack screenOptions={{headerTintColor: colors.ink, headerStyle: {backgroundColor: colors.white}, headerTitleStyle: {fontSize: 16}, title: 'IRON Recrutement'}}><Stack.Screen name="index" options={{headerShown: false}}/><Stack.Screen name="identify" options={{title: 'Identification'}}/><Stack.Screen name="verify" options={{title: 'Validation SMS'}}/><Stack.Screen name="apply" options={{title: 'Déposer une candidature'}}/><Stack.Screen name="tracking" options={{title: 'Suivi de candidature'}}/><Stack.Screen name="login" options={{title: 'Accès RH'}}/><Stack.Screen name="staff" options={{title: 'Espace RH'}}/></Stack></CandidateSessionProvider></SessionProvider>; }
