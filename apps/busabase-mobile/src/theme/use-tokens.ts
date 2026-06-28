import { useColorScheme } from "react-native";
import { darkTokens, lightTokens, type Tokens } from "./tokens";

export function useTokens(): Tokens {
  const scheme = useColorScheme();
  return scheme === "dark" ? darkTokens : lightTokens;
}
