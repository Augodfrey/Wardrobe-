import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WardrobeProvider } from "./src/WardrobeContext";
import type { RootStackParamList } from "./src/navigation";
import AddItemScreen from "./src/screens/AddItemScreen";
import RecommendScreen from "./src/screens/RecommendScreen";
import WardrobeScreen from "./src/screens/WardrobeScreen";
import { colors } from "./src/theme";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.4 }}>{label}</Text>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800" },
      }}
    >
      <Tab.Screen
        name="Wardrobe"
        component={WardrobeScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="👕" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="What to wear"
        component={RecommendScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon label="✨" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <WardrobeProvider>
        <NavigationContainer>
          <StatusBar style="dark" />
          <Stack.Navigator
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerShadowVisible: false,
              headerTitleStyle: { fontWeight: "800" },
            }}
          >
            <Stack.Screen
              name="Tabs"
              component={Tabs}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AddItem"
              component={AddItemScreen}
              options={{ title: "Add item", presentation: "modal" }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </WardrobeProvider>
    </SafeAreaProvider>
  );
}
