import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type RootStackParamList = {
  Tabs: undefined;
  AddItem: undefined;
};

export type AddItemProps = NativeStackScreenProps<RootStackParamList, "AddItem">;
