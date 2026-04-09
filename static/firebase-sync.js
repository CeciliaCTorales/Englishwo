/**
 * Firestore + Auth (Google): misma lista en todos los dispositivos del usuario.
 * Requiere static/firebase-config.js con apiKey y proyecto válidos.
 */
(function () {
  const cfg = window.__FIREBASE_CONFIG__;
  if (!cfg || !String(cfg.apiKey || "").trim()) {
    window.PalabrasFirebase = {
      isConfigured: function () {
        return false;
      },
      whenAuthReady: function () {
        return Promise.resolve();
      },
      subscribePalabras: function () {
        return function () {};
      },
      getCurrentUser: function () {
        return null;
      },
    };
    return;
  }

  const app = firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore(app);

  let unsubSnapshot = null;
  const palabrasListeners = new Set();
  let lastPalabrasList = null;
  let authReadyResolve;
  const authReady = new Promise(function (resolve) {
    authReadyResolve = resolve;
  });

  function palabraToDoc(p) {
    return {
      id: Number(p.id),
      palabra: p.palabra || "",
      ejemplo: p.ejemplo || "",
      dicho: p.dicho || "",
      fecha: p.fecha || "",
      tema: p.tema || "",
      etiquetas: p.etiquetas || "",
      aprendido: !!p.aprendido,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
  }

  function docToPalabra(docSnap) {
    const d = docSnap.data() || {};
    return {
      id: Number(d.id),
      palabra: d.palabra || "",
      ejemplo: d.ejemplo || "",
      dicho: d.dicho || "",
      fecha: d.fecha || "",
      tema: d.tema || "",
      etiquetas: d.etiquetas || "",
      aprendido: !!d.aprendido,
    };
  }

  function notifyPalabras(list) {
    lastPalabrasList = list;
    palabrasListeners.forEach(function (fn) {
      try {
        fn(list);
      } catch (e) {
        console.warn("PalabrasFirebase listener", e);
      }
    });
  }

  function attachSnapshot(uid) {
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
    const ref = db.collection("users").doc(uid).collection("palabras");
    let firstSync = true;
    unsubSnapshot = ref.onSnapshot(
      function (snap) {
        if (firstSync && snap.empty) {
          const local = (window.__exportPalabrasForFirebase &&
            window.__exportPalabrasForFirebase()) || [];
          if (local.length > 0) {
            const batch = db.batch();
            local.forEach(function (p) {
              batch.set(ref.doc(String(p.id)), palabraToDoc(p));
            });
            batch.commit().catch(function (e) {
              console.error("Firebase batch", e);
            });
            firstSync = false;
            return;
          }
          firstSync = false;
          notifyPalabras([]);
          return;
        }
        firstSync = false;
        var list = snap.docs
          .map(docToPalabra)
          .sort(function (a, b) {
            return Number(b.id) - Number(a.id);
          });
        notifyPalabras(list);
        if (typeof window.__applyFirebasePalabras === "function") {
          window.__applyFirebasePalabras(list);
        }
      },
      function (err) {
        console.error("Firestore snapshot", err);
      }
    );
  }

  auth.onAuthStateChanged(function (user) {
    if (typeof authReadyResolve === "function") {
      authReadyResolve();
      authReadyResolve = null;
    }
    if (unsubSnapshot) {
      unsubSnapshot();
      unsubSnapshot = null;
    }
    lastPalabrasList = null;
    if (!user) {
      return;
    }
    attachSnapshot(user.uid);
  });

  window.PalabrasFirebase = {
    isConfigured: function () {
      return true;
    },
    getApp: function () {
      return app;
    },
    getCurrentUser: function () {
      return auth.currentUser;
    },
    whenAuthReady: function () {
      return authReady;
    },
    subscribePalabras: function (fn) {
      if (typeof fn !== "function") return function () {};
      palabrasListeners.add(fn);
      if (lastPalabrasList) {
        try {
          fn(lastPalabrasList);
        } catch (e) {
          /* */
        }
      }
      return function () {
        palabrasListeners.delete(fn);
      };
    },
    signInWithGoogle: function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      return auth.signInWithPopup(provider);
    },
    signOut: function () {
      return auth.signOut().then(function () {
        location.reload();
      });
    },
    upsertPalabra: function (p) {
      var u = auth.currentUser;
      if (!u) return Promise.reject(new Error("no user"));
      return db
        .collection("users")
        .doc(u.uid)
        .collection("palabras")
        .doc(String(p.id))
        .set(palabraToDoc(p));
    },
    deletePalabra: function (id) {
      var u = auth.currentUser;
      if (!u) return Promise.reject(new Error("no user"));
      return db
        .collection("users")
        .doc(u.uid)
        .collection("palabras")
        .doc(String(id))
        .delete();
    },
    onAuthStateChanged: function (cb) {
      return auth.onAuthStateChanged(cb);
    },
  };

  function wireFirebaseAuthUi() {
    document.querySelectorAll("[data-firebase-signin]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.PalabrasFirebase.signInWithGoogle().catch(function (e) {
          console.warn(e);
        });
      });
    });
    document.querySelectorAll("[data-firebase-signout]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.PalabrasFirebase.signOut();
      });
    });
    window.PalabrasFirebase.onAuthStateChanged(function (u) {
      document.querySelectorAll("[data-firebase-auth-status]").forEach(function (el) {
        el.textContent = u ? u.email || u.displayName || "Nube" : "";
      });
      document.querySelectorAll("[data-firebase-signin]").forEach(function (b) {
        b.hidden = !!u;
      });
      document.querySelectorAll("[data-firebase-signout]").forEach(function (b) {
        b.hidden = !u;
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireFirebaseAuthUi);
  } else {
    wireFirebaseAuthUi();
  }
})();
