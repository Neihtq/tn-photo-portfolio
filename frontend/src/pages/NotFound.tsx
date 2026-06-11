import { Link } from "react-router-dom";
import "./NotFound.css";

export function NotFound() {
  return (
    <div className="content not-found">
      <h1 className="page-title">Page not found</h1>
      <p className="not-found-text">
        The page you were looking for has drifted out of frame.
      </p>
      <Link className="not-found-home" to="/">
        return home
      </Link>
    </div>
  );
}
