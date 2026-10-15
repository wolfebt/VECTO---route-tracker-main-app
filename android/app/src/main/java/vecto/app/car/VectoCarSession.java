package vecto.app.car;

import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.car.app.Screen;
import androidx.car.app.Session;

/**
 * Android Auto session lifecycle manager.
 */
public class VectoCarSession extends Session {
    @NonNull
    @Override
    public Screen onCreateScreen(@NonNull Intent intent) {
        return new JobListCarScreen(getCarContext());
    }
}
