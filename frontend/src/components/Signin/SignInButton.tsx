import { useMsal } from "@azure/msal-react";
import { loginRequest } from "../../authConfig";
import { LockOpen12Regular } from "@fluentui/react-icons";
import styles from "./SignIn.module.css";

/**
 * Renders a drop down button with child buttons for logging in with a popup or redirect
 * Note the [useMsal] package 
 */

export const SignInButton = () => {
  const { instance } = useMsal();

  const handleLogin = (loginType: any) => {
    if (loginType === "redirect") {
      instance.loginRedirect(loginRequest).catch(e => {
        console.log(e);
      });
    }
  };
  return (
    <LockOpen12Regular
      className={styles.signinIcon}
      style={{
      background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #0F6CBD 33.63%, #2D87C3 70.31%, #8DDDD8 100%)",
      cursor: "pointer",
      }}
      onClick={() => handleLogin("redirect")}
      onKeyDown={(e) =>
      e.key === "Enter" || e.key === " " ? handleLogin("redirect") : null
      }
      aria-label="Login"
      role="button"
      tabIndex={0}
    />
  );
};