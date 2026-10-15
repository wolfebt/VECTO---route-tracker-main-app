package vecto.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import vecto.app.car.VectoCarBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VectoCarBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
