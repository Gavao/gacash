package it.ga.gacash;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Guscio Android di GACash: una WebView che mostra l'app web pubblicata su GitHub Pages.
 * Così ogni modifica pubblicata arriva sul telefono alla riapertura, senza reinstallare l'APK;
 * il service worker dell'app la tiene in memoria per l'uso offline. Qui resta solo ciò che
 * il browser da solo non sa fare: backup in Download, selettore di file, tasto Indietro e
 * aggiornamento dell'APK stesso. I dati (spese, entrate, scontrini) restano nel telefono.
 */
public class MainActivity extends Activity {
    private static final String HOST = "gavao.github.io";
    private static final String HOME = "https://" + HOST + "/gacash/";
    private static final String OFFLINE_PAGE = "<html><body style='background:#0b1220;color:#eef2fb;"
            + "font-family:sans-serif;text-align:center;padding:40% 24px'>"
            + "<p>Per il primo avvio GACash ha bisogno della connessione a internet.</p>"
            + "<p><a href='" + HOME + "' style='color:#f2c14e'>Riprova</a></p></body></html>";
    private static final String BACKUP_DIR = Environment.DIRECTORY_DOWNLOADS + "/GACash";
    private static final String BACKUP_NAME = "gacash-backup.json";
    private static final int PICK_FILE = 1;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF0B1220);
        getWindow().setNavigationBarColor(0xFF121A2E);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B1220);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (HOST.equals(request.getUrl().getHost())) return false;
                openExternal(request.getUrl());   // i link esterni (es. i video su YouTube) si aprono fuori
                return true;
            }

            // Solo se l'app non è mai stata aperta online: dopo, la serve il service worker.
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) view.loadDataWithBaseURL(HOME, OFFLINE_PAGE, "text/html", "utf-8", null);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            // <input type="file">: backup da ripristinare e foto degli scontrini. Per lo scontrino
            // (capture) si sceglie tra la Fotocamera e la galleria.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                if (params.isCaptureEnabled()) {
                    // Android rifiuta l'app Fotocamera a chi dichiara il permesso CAMERA senza averlo ottenuto.
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) receiptPhoto();
                    else requestPermissions(new String[]{Manifest.permission.CAMERA}, PHOTO_PERMISSION);
                    return true;
                }
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try {
                    startActivityForResult(pick, PICK_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                }
                return true;
            }
        });

        web.loadUrl(HOME);
        deletePhotos();   // foto degli scontrini rimaste dall'ultima volta (l'app ne tiene una copia sua)
    }

    // -----------------------------------------------------------------------------------------
    // Foto dello scontrino: Fotocamera o galleria. Lo scatto si salva in Immagini/GACash solo il tempo
    // di leggerlo (l'app ne tiene una copia ridotta): si cancella al prossimo scatto e all'apertura.
    // -----------------------------------------------------------------------------------------
    private static final int TAKE_PHOTO = 3;
    private static final int PHOTO_PERMISSION = 4;
    private static final String PHOTO_DIR = Environment.DIRECTORY_PICTURES + "/GACash/";
    private Uri photoUri;

    private void receiptPhoto() {
        deletePhotos();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, "scontrino-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, PHOTO_DIR);
        photoUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        Intent shot = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent gallery = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        Intent chooser = Intent.createChooser(gallery, "Foto dello scontrino")
                .putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{shot});
        try {
            if (photoUri == null) throw new IOException("Immagini non disponibili");
            startActivityForResult(chooser, TAKE_PHOTO);
        } catch (Exception e) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
    }

    private void deletePhotos() {
        try {
            getContentResolver().delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?", new String[]{PHOTO_DIR + "%"});
        } catch (Exception ignored) {
            // niente da cancellare
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode != PHOTO_PERMISSION || fileCallback == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            receiptPhoto();
        } else {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (fileCallback == null) return;
        if (requestCode == TAKE_PHOTO) {
            // Dalla galleria arriva l'indirizzo della foto scelta; dalla Fotocamera niente (è in photoUri).
            Uri picked = data != null && data.getData() != null ? data.getData() : photoUri;
            fileCallback.onReceiveValue(resultCode == RESULT_OK && picked != null ? new Uri[]{picked} : null);
            fileCallback = null;
            return;
        }
        if (requestCode != PICK_FILE) return;
        Uri picked = resultCode == RESULT_OK && data != null ? data.getData() : null;
        fileCallback.onReceiveValue(picked == null ? null : new Uri[]{picked});
        fileCallback = null;
    }

    /** Tasto Indietro: prima chiude la finestra aperta, poi torna alla pagina precedente, infine esce. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else finish();
        });
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // nessuna app in grado di aprirlo
        }
    }

    /**
     * Scarica il nuovo APK con il gestore download di Android e, finito, apre l'installazione.
     * La prima volta Android chiede di consentire a GACash di installare app: si apre
     * l'impostazione apposita e, dopo averla attivata, basta toccare di nuovo "Aggiorna".
     */
    private void startUpdate(String url) {
        if (!getPackageManager().canRequestPackageInstalls()) {
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName())));
            return;
        }
        DownloadManager downloads = getSystemService(DownloadManager.class);
        java.io.File old = new java.io.File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "GACash-update.apk");
        if (old.exists()) old.delete();
        long id = downloads.enqueue(new DownloadManager.Request(Uri.parse(url))
                .setTitle("Aggiornamento GACash")
                .setMimeType("application/vnd.android.package-archive")
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "GACash-update.apk")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE));

        BroadcastReceiver done = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return;
                unregisterReceiver(this);
                Uri apk = downloads.getUriForDownloadedFile(id);
                if (apk == null) return;   // download non riuscito
                startActivity(new Intent(Intent.ACTION_VIEW)
                        .setDataAndType(apk, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK));
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(done, filter, Context.RECEIVER_EXPORTED);
        else registerReceiver(done, filter);
    }

    /** Funzioni native richiamabili dall'app web come window.Android. */
    private class Bridge {
        /** Versione dell'APK installato, es. "1.1": l'app web la confronta con l'ultima release su GitHub. */
        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "0";
            }
        }

        @JavascriptInterface
        public void installUpdate(String url) {
            runOnUiThread(() -> startUpdate(url));
        }

        /** Condivide un testo con un'altra app (WhatsApp, email…), dal menu di condivisione di Android. */
        @JavascriptInterface
        public void shareText(String title, String text) {
            Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(send, title)));
        }

        /**
         * Salva un file di testo (es. l'esportazione per Excel) in Download/GACash e restituisce il
         * percorso, oppure una stringa vuota se non riesce.
         */
        @JavascriptInterface
        public String saveFile(String name, String mime, String content) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, BACKUP_DIR);
                Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                try (OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                return "Download/GACash/" + name;
            } catch (Exception e) {
                return "";
            }
        }

        /**
         * Scrive la copia di sicurezza in Download/GACash, una cartella che resta anche se
         * l'app viene disinstallata. Restituisce il percorso, oppure una stringa vuota se fallisce.
         */
        @JavascriptInterface
        public String saveBackup(String json) {
            try {
                writeBackup(json);
                return "Download/GACash/" + BACKUP_NAME;
            } catch (Exception e) {
                return "";
            }
        }

        /**
         * Aggiorna la copia di sicurezza e la passa al menu di condivisione di Android: da lì si sceglie
         * "Salva su Drive" (o email, WhatsApp…). Restituisce false se non riesce.
         */
        @JavascriptInterface
        public boolean shareBackup(String json) {
            try {
                share(writeBackup(json), "application/json", "Backup GACash");
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** Salva un file in Download/GACash (es. l'esportazione per Excel) e lo passa al menu di condivisione. */
        @JavascriptInterface
        public boolean shareFile(String name, String mime, String content) {
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, BACKUP_DIR);
                Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                try (OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                }
                share(target, mime, name);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    /** Scrive (o sovrascrive) la copia di sicurezza in Download/GACash e ne restituisce l'indirizzo. */
    private Uri writeBackup(String json) throws IOException {
        ContentResolver resolver = getContentResolver();
        Uri downloads = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        Uri target = null;
        try (Cursor c = resolver.query(downloads, new String[]{MediaStore.MediaColumns._ID},
                MediaStore.MediaColumns.DISPLAY_NAME + "=? AND " + MediaStore.MediaColumns.RELATIVE_PATH + " LIKE ?",
                new String[]{BACKUP_NAME, "%GACash%"}, null)) {
            if (c != null && c.moveToFirst()) target = ContentUris.withAppendedId(downloads, c.getLong(0));
        }
        if (target == null) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, BACKUP_NAME);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, BACKUP_DIR);
            target = resolver.insert(downloads, values);
        }
        try (OutputStream out = resolver.openOutputStream(target, "wt")) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
        return target;
    }

    private void share(Uri uri, String mime, String title) {
        Intent send = new Intent(Intent.ACTION_SEND).setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri).putExtra(Intent.EXTRA_SUBJECT, title)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        runOnUiThread(() -> startActivity(Intent.createChooser(send, title)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)));
    }
}
