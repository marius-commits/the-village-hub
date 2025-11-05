class CustomNavbar extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        nav {
          background: white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          position: fixed;
          width: 100%;
          top: 0;
          z-index: 1000;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 80px;
        }
        .logo-container {
          display: flex;
          align-items: center;
        }
        .logo-img {
          height: 50px;
          width: auto;
        }
        .logo-text {
          margin-left: 12px;
          font-size: 24px;
          font-weight: 700;
          color: #6B4423;
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: 24px;
        }
        .nav-link {
          color: #6B4423;
          text-decoration: none;
          font-weight: 500;
          font-size: 16px;
          transition: color 0.2s;
          position: relative;
          padding-bottom: 4px;
        }
        .nav-link:hover {
          color: #8B5A2B;
        }
        .nav-link.active {
          border-bottom: 2px solid #8B5A2B;
        }
        .cta-button {
          background: linear-gradient(135deg,#8A9A5B 0%,#6F7A45 100%);
          color: white;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 600;
          transition: all 0.2s;
        }
        .cta-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        .mobile-menu-btn {
          display: none;
          background: none;
          border: none;
          cursor: pointer;
        }
        @media (max-width: 768px) {
          .nav-links {
            display: none;
          }
          .mobile-menu-btn {
            display: block;
          }
          .tablist {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            padding: 8px;
          }
          .tab {
            width: 100%;
            padding: 10px;
            font-size: 14px;
            text-align: center;
          }
        }
</style>
      <nav>
        <div class="container">
          <div class="logo-container">
            <img class="logo-img" src="https://huggingface.co/spaces/Mariusvj86/the-village-hub/resolve/main/images/Logo%20without%20words.png" alt="Village Hub Logo">
            <span class="logo-text">The Village Hub</span>
          </div>
          <div class="nav-links">
            <a href="/" class="nav-link">Home</a>
            <a href="/#about" class="nav-link">About</a>
            <a href="/#features" class="nav-link">Features</a>
            <a href="/#gallery" class="nav-link">Gallery</a>
            <a href="/#community" class="nav-link">Community</a>
            <a href="/pricing.html" class="nav-link">Pricing</a>
            <a href="/coworking-vs-traditional-2.html" class="nav-link">Comparison</a>
            <a href="/pricing.html" class="cta-button">Explore Village Options</a>
          </div>
          <button class="mobile-menu-btn">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>
        </div>
      </nav>
    `;
  }
}

customElements.define('custom-navbar', CustomNavbar);