import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const TOAST_MS = 4000;

const AnnounceContext = createContext<Dispatch<SetStateAction<string>>>(() => undefined);

/**
 * One polite live region for the whole app. It doubles as the visible toast, so
 * the outcome of an action reaches sighted and screen-reader users alike.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <AnnounceContext.Provider value={setMessage}>
      {children}
      <div
        className={message ? "toast toast-visible" : "toast"}
        role="status"
        aria-live="polite"
        data-testid="announcer"
      >
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}

export function useAnnounce(): (message: string) => void {
  return useContext(AnnounceContext);
}
