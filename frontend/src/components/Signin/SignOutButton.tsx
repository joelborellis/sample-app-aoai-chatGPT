import { useMsal } from "@azure/msal-react";
import styles from "./SignIn.module.css";
import { LockClosed12Regular } from "@fluentui/react-icons";


/**
 * Renders a sign out button 
 */
export const SignOutButton = () => {
  const { instance } = useMsal();

  const handleLogout = (logoutType: any) => {
    if (logoutType === "redirect") {
      instance.logoutRedirect({
        postLogoutRedirectUri: "/",
    });
    } 
  };

  return (
    <LockClosed12Regular
      className={styles.signoutIcon}
      style={{
      background: "radial-gradient(109.81% 107.82% at 100.1% 90.19%, #0F6CBD 33.63%, #2D87C3 70.31%, #8DDDD8 100%)",
      cursor: "pointer",
      }}
      onClick={() => handleLogout("redirect")}
      onKeyDown={(e) =>
      e.key === "Enter" || e.key === " " ? handleLogout("redirect") : null
      }
      aria-label="Logout"
      role="button"
      tabIndex={0}
    />
  );
};