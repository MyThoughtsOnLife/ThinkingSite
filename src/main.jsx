import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import 'katex/dist/katex.min.css';
import './styles.css';
import './themes.css';
import './notebook.css';
import './markdown.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
